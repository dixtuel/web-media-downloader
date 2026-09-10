"""Downloader — YouTube extraction service.

yt-dlp tabanlı, tek amaçlı bir mikroservis: yalnızca bir video hakkında bilgi
ve doğrudan indirilebilir CDN URL'sini döner. Gerçek video baytları burada
diske hiç yazılmaz — video+ses ayrı akış olarak gelirse (modern YouTube'da
çoğu zaman böyle) ffmpeg iki uzak URL'yi doğrudan HTTP yanıtına pipe'layarak
gerçek zamanlı birleştirir (cobalt'ın /tunnel mantığıyla aynı prensip).
"""
import json
import os
import re
import subprocess
import threading
import time
from urllib.parse import quote

import httpx
import yt_dlp
from flask import Flask, Response, jsonify, request
from reddit import resolve_reddit_media

app = Flask(__name__)

POT_PROVIDER_URL = (os.environ.get("POT_PROVIDER_URL") or "http://pot-provider:4416").strip()
COOKIES_FILE = (os.environ.get("YTDLP_COOKIES_FILE") or "").strip()
YTDLP_COOKIES_TEXT = (os.environ.get("YTDLP_COOKIES_TEXT") or "").strip()
REDDIT_CLIENT_ID = (os.environ.get("REDDIT_CLIENT_ID") or "").strip()
REDDIT_CLIENT_SECRET = (os.environ.get("REDDIT_CLIENT_SECRET") or "").strip()
DENO_RELAY_URL = (os.environ.get("DENO_RELAY_URL") or "").strip()

# --- Güvenlik: SSRF ve kaynak-tüketimi koruması -----------------------------
YOUTUBE_URL_RE = re.compile(r"^https?://(?:[a-zA-Z0-9_-]+\.)*(youtube\.com|youtu\.be|music\.youtube\.com)/", re.I)
MEDIA_STREAM_URL_RE = re.compile(
    r"^https?://(?:[a-zA-Z0-9_-]+\.)*(googlevideo\.com|youtube\.com|ytimg\.com|redd\.it|reddit\.com|twimg\.com|twitter\.com|x\.com|sndcdn\.com|soundcloud\.com|soundcloud\.cloud|pinimg\.com|pinterest\.com|tiktokcdn\.com|tiktok\.com|ibytedtos\.com|byteoversea\.com|cdninstagram\.com|fbcdn\.net)/",
    re.I
)
GOOGLEVIDEO_URL_RE = MEDIA_STREAM_URL_RE
INSTAGRAM_URL_RE = re.compile(r"^https?://(?:www\.)?instagram\.com/(?:[^/]+/)?(p|reel|tv)/([A-Za-z0-9_-]+)", re.I)

# cobalt'ın kullandığı mobil API (i.instagram.com/api/v1/media/.../info/) IG
# tarafından 401/403 ile reddedilebiliyor (2026-08-31'de doğrulandı) — bu,
# cobalt'ın embed/captioned HTML fallback'inin Reels için yeterli veri
# taşımamasıyla birleşince indirme tamamen başarısız oluyor. Bu fallback,
# şortkodu doğrudan Instagram'ın web GraphQL uç noktasına (doc_id ile,
# yt-dlp'nin de kullandığı sabit sorgu) çevirerek aynı veriye ulaşır —
# mobil API'ye hiç dokunmaz.
_IG_SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
_IG_GRAPHQL_DOC_ID = "27130156389949648"
_IG_APP_ID = "936619743392459"
_IG_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

_RATE_LIMIT_MAX = int(os.environ.get("RATE_LIMIT_MAX", "30"))
_RATE_LIMIT_WINDOW_SEC = 60
_rate_state: dict[str, tuple[int, float]] = {}
_rate_lock = threading.Lock()


def _client_ip() -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.remote_addr or "unknown")


def rate_limited() -> bool:
    ip = _client_ip()
    now = time.time()
    with _rate_lock:
        count, window_start = _rate_state.get(ip, (0, now))
        if now - window_start > _RATE_LIMIT_WINDOW_SEC:
            count, window_start = 0, now
        count += 1
        _rate_state[ip] = (count, window_start)
        return count > _RATE_LIMIT_MAX


ADAPTER_ACTIVE = bool(DENO_RELAY_URL or os.environ.get("LAMBDA_RELAY_URL"))
LOCAL_ADAPTER_PROXY = "http://127.0.0.1:8888"


def build_format_selector(download_mode: str = "auto", quality: str = "max", codec: str = "h264", audio_format: str = "mp3") -> str:
    quality = (quality or "max").lower().strip()
    codec = (codec or "h264").lower().strip()
    download_mode = (download_mode or "auto").lower().strip()

    if download_mode == "audio":
        return "bestaudio/best[acodec!=none]/best"

    height_filter = f"[height<={quality}]" if quality in ("4320", "2160", "1440", "1080", "720", "480", "360", "240", "144") else ""

    if download_mode == "mute":
        if codec == "h264":
            return f"bestvideo*[vcodec^=avc1]{height_filter}/bestvideo*{height_filter}/best*{height_filter}/best"
        elif codec == "av1":
            return f"bestvideo*[vcodec^=av01]{height_filter}/bestvideo*{height_filter}/best*{height_filter}/best"
        elif codec == "vp9":
            return f"bestvideo*[vcodec^=vp]{height_filter}/bestvideo*{height_filter}/best*{height_filter}/best"
        return f"bestvideo*{height_filter}/best*{height_filter}/best"

    # download_mode == "auto" (Video + Audio)
    if codec == "h264":
        return (
            f"bestvideo*[vcodec^=avc1]{height_filter}+bestaudio/"
            f"bestvideo*{height_filter}+bestaudio/"
            f"bestvideo*+bestaudio/"
            f"best*{height_filter}/best"
        )
    elif codec == "av1":
        return (
            f"bestvideo*[vcodec^=av01]{height_filter}+bestaudio/"
            f"bestvideo*[vcodec^=av1]{height_filter}+bestaudio/"
            f"bestvideo*{height_filter}+bestaudio/"
            f"bestvideo*+bestaudio/"
            f"best*{height_filter}/best"
        )
    elif codec == "vp9":
        return (
            f"bestvideo*[vcodec^=vp]{height_filter}+bestaudio/"
            f"bestvideo*{height_filter}+bestaudio/"
            f"bestvideo*+bestaudio/"
            f"best*{height_filter}/best"
        )
    else:
        return f"bestvideo*{height_filter}+bestaudio/bestvideo*+bestaudio/best*{height_filter}/best"


def run_extract(url: str, fmt: str = None) -> dict:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 25,
        "remote_components": ["ejs:github"],
        "nocheckcertificate": True,
    }
    if fmt:
        ydl_opts["format"] = fmt
    if ADAPTER_ACTIVE:
        ydl_opts["proxy"] = LOCAL_ADAPTER_PROXY

    # Cookie bağlama
    cookie_path = None
    if YTDLP_COOKIES_TEXT and len(YTDLP_COOKIES_TEXT.strip()) > 30:
        try:
            cookie_tmp = "/tmp/cookies_env.txt"
            with open(cookie_tmp, "w", encoding="utf-8") as f:
                f.write(YTDLP_COOKIES_TEXT)
            cookie_path = cookie_tmp
        except Exception:
            pass
    elif COOKIES_FILE and os.path.isfile(COOKIES_FILE) and os.path.getsize(COOKIES_FILE) > 30:
        try:
            import shutil
            cookie_tmp = "/tmp/cookies_mounted.txt"
            shutil.copyfile(COOKIES_FILE, cookie_tmp)
            cookie_path = cookie_tmp
        except Exception:
            pass

    if cookie_path:
        ydl_opts["cookiefile"] = cookie_path
    else:
        ydl_opts.setdefault("extractor_args", {})["youtubepot-bgutilhttp"] = {"base_url": [POT_PROVIDER_URL]}

    if REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET:
        ydl_opts.setdefault("extractor_args", {})["reddit"] = {
            "client_id": [REDDIT_CLIENT_ID],
            "client_secret": [REDDIT_CLIENT_SECRET],
        }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        return ydl.extract_info(url, download=False)


def _shortcode_to_media_id(shortcode: str) -> str:
    media_id = 0
    for ch in shortcode:
        media_id = media_id * 64 + _IG_SHORTCODE_ALPHABET.index(ch)
    return str(media_id)


def instagram_graphql_extract(shortcode: str, post_type: str) -> dict:
    page_url = f"https://www.instagram.com/{post_type}/{shortcode}/"
    media_id = _shortcode_to_media_id(shortcode)

    client_kwargs = {
        "headers": {"User-Agent": _IG_USER_AGENT, "Accept-Language": "en-US,en;q=0.9"},
        "follow_redirects": True,
        "timeout": 20,
    }
    if ADAPTER_ACTIVE:
        client_kwargs["proxy"] = LOCAL_ADAPTER_PROXY
        client_kwargs["verify"] = False

    with httpx.Client(**client_kwargs) as client:
        page = client.get(page_url)
        page.raise_for_status()

        lsd_match = re.search(r'"LSD",\[\],\{"token":"([^"]+)"', page.text)
        if not lsd_match:
            raise RuntimeError("sayfa jetonu (lsd) bulunamadı")
        csrf = client.cookies.get("csrftoken")
        if not csrf:
            raise RuntimeError("csrf jetonu bulunamadı")

        gql_headers = {
            "Origin": "https://www.instagram.com",
            "Referer": page_url,
            "X-CSRFToken": csrf,
            "X-FB-LSD": lsd_match.group(1),
            "X-FB-Friendly-Name": "PolarisLoggedOutDesktopWWWPostRootContentQuery",
            "X-Requested-With": "XMLHttpRequest",
            "X-IG-App-ID": _IG_APP_ID,
            "X-ASBD-ID": "129477",
            "X-IG-WWW-Claim": "0",
        }
        gql_data = {
            "lsd": lsd_match.group(1),
            "fb_api_caller_class": "RelayModern",
            "fb_api_req_friendly_name": "PolarisLoggedOutDesktopWWWPostRootContentQuery",
            "server_timestamps": "true",
            "variables": json.dumps({"media_id": media_id}, separators=(",", ":")),
            "doc_id": _IG_GRAPHQL_DOC_ID,
        }
        gql_res = client.post("https://www.instagram.com/api/graphql", headers=gql_headers, data=gql_data)
        gql_res.raise_for_status()
        payload = gql_res.json()

    media = (payload.get("data") or {}).get("xig_polaris_media")
    if not media:
        raise RuntimeError("gönderi bulunamadı")

    gated = media.get("if_not_gated_logged_out")
    if not gated:
        raise RuntimeError("giriş gerektiren veya kısıtlı içerik")

    title = ((gated.get("caption") or {}).get("text") or "").strip() or f"instagram_{shortcode}"

    if gated.get("media_type") == 2:
        video_versions = gated.get("video_versions") or []
        if not video_versions:
            raise RuntimeError("video akışı bulunamadı")
        best = max(video_versions, key=lambda v: (v.get("width") or 0) * (v.get("height") or 0))
        return {"media_type": "video", "url": best["url"], "title": title, "thumbnail": gated.get("display_uri") or ""}

    candidates = ((gated.get("image_versions2") or {}).get("candidates")) or []
    if not candidates:
        raise RuntimeError("görsel akışı bulunamadı")
    best = max(candidates, key=lambda c: (c.get("width") or 0) * (c.get("height") or 0))
    return {"media_type": "photo", "url": best["url"], "title": title, "thumbnail": best["url"]}


@app.route("/instagram-extract", methods=["POST"])
def instagram_extract():
    if rate_limited():
        return jsonify({"status": "error", "error": {"code": "rate_limited", "message": "Çok fazla istek, biraz bekleyin."}}), 429

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    match = INSTAGRAM_URL_RE.match(url)
    if not url or not match:
        return jsonify({"status": "error", "error": {"code": "invalid_url", "message": "Geçerli bir Instagram gönderi/reel linki gerekli"}}), 400

    post_type, shortcode = match.group(1).lower(), match.group(2)

    try:
        result = instagram_graphql_extract(shortcode, post_type)
    except Exception as exc:
        return jsonify({"status": "error", "error": {"code": "extract_failed", "message": str(exc)}}), 502

    ext = "mp4" if result["media_type"] == "video" else "jpg"
    return jsonify({
        "status": "ok",
        "provider": "instagram",
        "media_type": result["media_type"],
        "title": result["title"],
        "thumbnail": result["thumbnail"],
        "url": result["url"],
        "filename": f"instagram_{shortcode}.{ext}",
    })


@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "ytdlp-service"})


@app.route("/analyze", methods=["POST"])
@app.route("/info", methods=["POST"])
def analyze_video():
    if rate_limited():
        return jsonify({"status": "error", "error": {"code": "rate_limited", "message": "Çok fazla istek, biraz bekleyin."}}), 429

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url or not url.startswith(("http://", "https://")):
        return jsonify({"status": "error", "error": {"code": "invalid_url", "message": "Geçerli bir medya URL'si gerekli"}}), 400

    if "reddit.com" in url or "redd.it" in url:
        try:
            reddit_res = resolve_reddit_media(url)
            if reddit_res.get("status") == "ok":
                return jsonify(reddit_res)
            return jsonify(reddit_res), 400
        except Exception as exc:
            return jsonify({"status": "error", "error": {"code": "reddit_failed", "message": f"Reddit çözümlenemedi: {exc}"}}), 502

    try:
        raw_info = run_extract(url, fmt=None)
    except Exception as exc:
        return jsonify({"status": "error", "error": {"code": "analyze_failed", "message": str(exc)}}), 502

    extractor_key = (raw_info.get("extractor_key") or "").lower()
    if "youtube" in extractor_key or "youtu" in url:
        provider = "youtube"
    elif "reddit" in extractor_key or "reddit" in url:
        provider = "reddit"
    elif "twitter" in extractor_key or "x.com" in url or "twit" in url:
        provider = "twitter"
    elif "soundcloud" in extractor_key or "soundcloud" in url:
        provider = "soundcloud"
    elif "pinterest" in extractor_key or "pinterest" in url:
        provider = "pinterest"
    elif "tiktok" in extractor_key or "tiktok" in url:
        provider = "tiktok"
    elif "instagram" in extractor_key or "instagram" in url:
        provider = "instagram"
    else:
        provider = extractor_key or "generic"

    title = (raw_info.get("title") or f"{provider.capitalize()} Medyası").strip()
    thumbnail = raw_info.get("thumbnail") or ""
    duration_sec = float(raw_info.get("duration") or 0)
    uploader = raw_info.get("uploader") or raw_info.get("channel") or ""

    mins = int(duration_sec // 60)
    secs = int(duration_sec % 60)
    duration_str = f"{mins}:{secs:02d}" if duration_sec > 0 else ""

    all_heights = [f.get("height") for f in raw_info.get("formats", []) if f.get("height") and f.get("height") >= 144]
    unique_heights = sorted(list(set(all_heights)), reverse=True)

    LABEL_MAP = {
        4320: "8K UHD (4320p)",
        2160: "4K UHD (2160p)",
        1440: "2K QHD (1440p)",
        1080: "1080p Full HD",
        720: "720p HD",
        480: "480p SD",
        360: "360p",
        240: "240p",
        144: "144p"
    }

    qualities = []
    is_audio_only = (provider == "soundcloud") or (len(unique_heights) == 0)

    if not is_audio_only:
        max_h = unique_heights[0] if unique_heights else 1080
        qualities.append({
            "id": "max",
            "label": f"En Yüksek ({max_h}p)",
            "height": max_h,
            "is_default": True
        })

        for h in unique_heights:
            lbl = LABEL_MAP.get(h, f"{h}p")
            qualities.append({
                "id": str(h),
                "label": lbl,
                "height": h,
                "is_default": False
            })

    return jsonify({
        "status": "ok",
        "provider": provider,
        "is_audio_only": is_audio_only,
        "title": title,
        "thumbnail": thumbnail,
        "duration": duration_sec,
        "duration_str": duration_str,
        "uploader": uploader,
        "qualities": qualities,
        "audio_bitrates": [
            {"id": "320", "label": "320 kbps (En Yüksek)", "is_default": True},
            {"id": "256", "label": "256 kbps", "is_default": False},
            {"id": "128", "label": "128 kbps (Standart)", "is_default": False}
        ]
    })


@app.route("/extract", methods=["POST"])
def extract():
    if rate_limited():
        return jsonify({"status": "error", "error": {"code": "rate_limited", "message": "Çok fazla istek, biraz bekleyin."}}), 429

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url or not url.startswith(("http://", "https://")):
        return jsonify({"status": "error", "error": {"code": "invalid_url", "message": "Geçerli bir medya URL'si gerekli"}}), 400

    download_mode = (data.get("downloadMode") or "auto").strip()
    if "soundcloud.com" in url or "on.soundcloud.com" in url:
        download_mode = "audio"
    video_quality = (data.get("videoQuality") or data.get("vQuality") or "max").strip()
    codec = (data.get("youtubeVideoCodec") or data.get("vCodec") or "h264").strip()
    audio_format = (data.get("audioFormat") or data.get("aFormat") or "mp3").strip()
    audio_bitrate = (data.get("audioBitrate") or "128").strip()

    if "reddit.com" in url or "redd.it" in url:
        try:
            reddit_res = resolve_reddit_media(url)
            if reddit_res.get("status") == "ok":
                raw_title = (reddit_res.get("title") or "reddit_media").strip()
                safe_title = re.sub(r'[^\w\s\.-]', '_', raw_title)
                
                if reddit_res.get("is_photo"):
                    direct_img = reddit_res.get("direct_url")
                    ext = direct_img.split(".")[-1].lower() if "." in direct_img else "jpg"
                    return jsonify({
                        "status": "redirect",
                        "url": direct_img,
                        "filename": f"{safe_title}.{ext}",
                        "adapter": False
                    })
                
                if download_mode == "audio":
                    a_url = reddit_res.get("audio_url")
                    if not a_url:
                        return jsonify({"status": "error", "error": {"code": "no_audio", "message": "Bu Reddit videosunda ses bulunmuyor"}}), 400
                    remux_path = (
                        f"/youtube-remux?audio={quote(a_url, safe='')}&mode=audio"
                        f"&format=mp3&bitrate={audio_bitrate}&filename={quote(f'{safe_title}.mp3', safe='')}"
                    )
                    return jsonify({
                        "status": "redirect",
                        "url": remux_path,
                        "filename": f"{safe_title}.mp3",
                        "adapter": ADAPTER_ACTIVE
                    })

                v_qualities = reddit_res.get("qualities", [])
                chosen_v = None
                if video_quality and video_quality != "max":
                    for q in v_qualities:
                        if str(q.get("id")) == str(video_quality) or str(q.get("height")) == str(video_quality):
                            chosen_v = q.get("video_url")
                            break
                if not chosen_v and v_qualities:
                    chosen_v = v_qualities[0].get("video_url")

                a_url = reddit_res.get("audio_url")
                if a_url and download_mode != "mute":
                    remux_path = (
                        f"/youtube-remux?video={quote(chosen_v, safe='')}"
                        f"&audio={quote(a_url, safe='')}"
                        f"&filename={quote(f'{safe_title}.mp4', safe='')}"
                    )
                else:
                    remux_path = (
                        f"/youtube-remux?video={quote(chosen_v, safe='')}"
                        f"&mode=mute"
                        f"&filename={quote(f'{safe_title}.mp4', safe='')}"
                    )
                return jsonify({"status": "redirect", "url": remux_path, "filename": f"{safe_title}.mp4", "adapter": ADAPTER_ACTIVE})
            return jsonify(reddit_res), 400
        except Exception as exc:
            return jsonify({"status": "error", "error": {"code": "reddit_extract_failed", "message": f"Reddit indirilemedi: {exc}"}}), 502

    fmt = build_format_selector(download_mode, video_quality, codec, audio_format)

    try:
        info = run_extract(url, fmt)
    except Exception as exc:
        return jsonify({"status": "error", "error": {"code": "extract_failed", "message": str(exc)}}), 502

    title = (info.get("title") or "video").strip()
    requested = info.get("requested_formats")

    if download_mode == "audio":
        audio_url = None
        if requested and len(requested) > 0:
            audio_url = requested[-1].get("url")
        if not audio_url:
            audio_url = info.get("url")
        if not audio_url and info.get("requested_downloads"):
            audio_url = info["requested_downloads"][0].get("url")

        if not audio_url:
            return jsonify({"status": "error", "error": {"code": "no_stream", "message": "Ses linki bulunamadı"}}), 502

        out_ext = "mp3" if audio_format not in ("m4a", "opus", "ogg", "wav") else audio_format
        remux_path = (
            f"/youtube-remux?audio={quote(audio_url, safe='')}&mode=audio"
            f"&format={out_ext}&bitrate={audio_bitrate}&filename={quote(f'{title}.{out_ext}', safe='')}"
        )
        return jsonify({
            "status": "redirect",
            "url": remux_path,
            "filename": f"{title}.{out_ext}",
            "adapter": ADAPTER_ACTIVE,
        })

    if download_mode == "mute":
        video_url = None
        if requested and len(requested) > 0:
            video_fmt = requested[0]
            video_url = video_fmt.get("url")
            v_ext = video_fmt.get("ext", "mp4")
        else:
            video_url = info.get("url")
            v_ext = info.get("ext", "mp4")

        if not video_url:
            return jsonify({"status": "error", "error": {"code": "no_stream", "message": "Video linki bulunamadı"}}), 502

        out_ext = "webm" if (codec == "vp9" or v_ext == "webm") else "mp4"
        remux_path = (
            f"/youtube-remux?video={quote(video_url, safe='')}&mode=mute"
            f"&ext={out_ext}&filename={quote(f'{title}.{out_ext}', safe='')}"
        )
        return jsonify({
            "status": "redirect",
            "url": remux_path,
            "filename": f"{title}.{out_ext}",
            "adapter": ADAPTER_ACTIVE,
        })

    # download_mode == "auto" (Video + Audio)
    if requested and len(requested) >= 2:
        video_fmt, audio_fmt = requested[0], requested[1]
        video_url = video_fmt.get("url")
        audio_url = audio_fmt.get("url")
        if not video_url or not audio_url:
            return jsonify({"status": "error", "error": {"code": "no_stream", "message": "İndirme linki bulunamadı"}}), 502

        out_ext = "webm" if (codec == "vp9" and video_fmt.get("ext") == "webm") else "mp4"
        remux_path = (
            f"/youtube-remux?video={quote(video_url, safe='')}&audio={quote(audio_url, safe='')}"
            f"&ext={out_ext}&vcodec={quote(video_fmt.get('vcodec') or '', safe='')}&acodec={quote(audio_fmt.get('acodec') or '', safe='')}"
            f"&filename={quote(f'{title}.{out_ext}', safe='')}"
        )
        return jsonify({
            "status": "redirect",
            "url": remux_path,
            "filename": f"{title}.{out_ext}",
            "adapter": ADAPTER_ACTIVE,
        })

    direct_url = info.get("url")
    if not direct_url and info.get("requested_downloads"):
        direct_url = info["requested_downloads"][0].get("url")
    if not direct_url:
        return jsonify({"status": "error", "error": {"code": "no_stream", "message": "İndirme linki bulunamadı"}}), 502

    extractor_key = (info.get("extractor_key") or "").lower()
    is_sound_only = (
        "soundcloud" in extractor_key
        or "soundcloud.com" in url
        or info.get("vcodec") == "none"
        or (info.get("ext") in ("mp3", "m4a", "ogg", "opus", "wav"))
        or (".m3u8" in direct_url)
    )

    if is_sound_only:
        out_ext = "mp3" if audio_format not in ("m4a", "opus", "ogg", "wav") else audio_format
        remux_path = (
            f"/youtube-remux?audio={quote(direct_url, safe='')}&mode=audio"
            f"&format={out_ext}&bitrate={audio_bitrate}&filename={quote(f'{title}.{out_ext}', safe='')}"
        )
        return jsonify({
            "status": "redirect",
            "url": remux_path,
            "filename": f"{title}.{out_ext}",
            "adapter": ADAPTER_ACTIVE,
        })

    ext = info.get("ext", "mp4")
    return jsonify({
        "status": "redirect",
        "url": direct_url,
        "filename": f"{title}.{ext}",
        "adapter": ADAPTER_ACTIVE,
    })


@app.route("/remux", methods=["GET"])
def remux():
    if rate_limited():
        return "Çok fazla istek, biraz bekleyin.", 429

    mode = (request.args.get("mode") or "video").strip()
    video_url = (request.args.get("video") or "").strip()
    audio_url = (request.args.get("audio") or "").strip()
    ext = (request.args.get("ext") or "mp4").strip().lower()
    fmt_param = (request.args.get("format") or ext).strip().lower()
    bitrate = (request.args.get("bitrate") or "128").strip()
    filename = (request.args.get("filename") or f"media.{ext}").strip()

    UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    if mode == "audio":
        if not audio_url or not GOOGLEVIDEO_URL_RE.match(audio_url):
            return "Geçersiz kaynak URL", 400

        if fmt_param == "mp3":
            args = [
                "ffmpeg", "-loglevel", "error",
                "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
                "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
                "-user_agent", UA,
                "-i", audio_url,
                "-vn", "-c:a", "libmp3lame", "-b:a", f"{bitrate}k",
                "-f", "mp3", "pipe:1"
            ]
            mimetype = "audio/mpeg"
        elif fmt_param in ("opus", "ogg"):
            args = [
                "ffmpeg", "-loglevel", "error",
                "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
                "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
                "-user_agent", UA,
                "-i", audio_url,
                "-vn", "-c:a", "copy",
                "-f", "opus" if fmt_param == "opus" else "ogg", "pipe:1"
            ]
            mimetype = "audio/opus" if fmt_param == "opus" else "audio/ogg"
        elif fmt_param == "wav":
            args = [
                "ffmpeg", "-loglevel", "error",
                "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
                "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
                "-user_agent", UA,
                "-i", audio_url,
                "-vn", "-c:a", "pcm_s16le",
                "-f", "wav", "pipe:1"
            ]
            mimetype = "audio/wav"
        else:  # m4a, aac, best
            args = [
                "ffmpeg", "-loglevel", "error",
                "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
                "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
                "-user_agent", UA,
                "-i", audio_url,
                "-vn", "-c:a", "copy",
                "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1"
            ]
            mimetype = "audio/mp4"

    elif mode == "mute":
        if not video_url or not GOOGLEVIDEO_URL_RE.match(video_url):
            return "Geçersiz kaynak URL", 400
        args = [
            "ffmpeg", "-loglevel", "error",
            "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
            "-user_agent", UA,
            "-i", video_url,
            "-an", "-c:v", "copy",
            "-f", ext if ext in ("webm", "matroska") else "mp4",
        ]
        if ext == "mp4":
            args += ["-movflags", "frag_keyframe+empty_moov+default_base_moof"]
        args += ["pipe:1"]
        mimetype = "video/webm" if ext == "webm" else "video/mp4"

    else:  # Video + Audio
        if not video_url or not audio_url or not GOOGLEVIDEO_URL_RE.match(video_url) or not GOOGLEVIDEO_URL_RE.match(audio_url):
            return "Geçersiz kaynak URL", 400

        acodec = (request.args.get("acodec") or "").lower()
        args = [
            "ffmpeg", "-loglevel", "error",
            "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
            "-user_agent", UA,
            "-i", video_url,
            "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
            "-user_agent", UA,
            "-i", audio_url,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac" if (ext == "mp4" and "opus" in acodec) else "copy",
            "-f", ext if ext in ("webm", "matroska") else "mp4",
        ]
        if ext == "mp4":
            args += ["-movflags", "frag_keyframe+empty_moov+default_base_moof"]
        args += ["pipe:1"]
        mimetype = "video/webm" if ext == "webm" else "video/mp4"

    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=1024 * 64)

    def generate():
        try:
            while True:
                chunk = proc.stdout.read(1024 * 64)
                if not chunk:
                    break
                yield chunk
        finally:
            proc.stdout.close()
            proc.terminate()

    clean_ascii = re.sub(r'[^\x20-\x7E]', '_', filename).replace('"', '_')
    headers = {
        "Content-Disposition": f'attachment; filename="{clean_ascii}"; filename*=UTF-8\'\'{quote(filename)}',
        "Content-Type": mimetype,
        "Cache-Control": "no-cache, no-store",
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": "bytes",
    }
    return Response(generate(), mimetype=mimetype, headers=headers)


@app.route("/music", methods=["POST"])
def music_resolve():
    data = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()
    if not query:
        return jsonify({"status": "error", "message": "query parameter required"}), 400

    target = query if YOUTUBE_URL_RE.match(query) else f"ytsearch1:{query}"
    try:
        raw_info = run_extract(target, fmt="bestaudio[acodec=opus]/bestaudio/best")
        resolved = raw_info["entries"][0] if "entries" in raw_info else raw_info
        stream_url = resolved.get("url")
        if not stream_url and resolved.get("requested_downloads"):
            stream_url = resolved["requested_downloads"][0].get("url")
        if not stream_url:
            return jsonify({"status": "error", "message": "Ses akışı linki bulunamadı"}), 502

        title = (resolved.get("title") or query).strip()
        channel = str(resolved.get("uploader") or resolved.get("channel") or "").strip()
        thumbnail = resolved.get("thumbnail") or ""
        duration = resolved.get("duration") or 0
        webpage_url = resolved.get("webpage_url") or (f"https://www.youtube.com/watch?v={resolved.get('id')}" if resolved.get("id") else "")
        artist = str(resolved.get("artist") or resolved.get("creator") or channel).strip()
        album = str(resolved.get("album") or "").strip()

        headers = resolved.get("http_headers") or {}
        if "User-Agent" not in headers:
            headers["User-Agent"] = _IG_USER_AGENT

        return jsonify({
            "status": "ok",
            "title": title,
            "artist": artist,
            "album": album,
            "duration": duration,
            "thumbnail": thumbnail,
            "channel": channel,
            "webpage_url": webpage_url,
            "stream_url": stream_url,
            "http_headers": headers,
            "user_agent": headers.get("User-Agent", _IG_USER_AGENT),
        })
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

