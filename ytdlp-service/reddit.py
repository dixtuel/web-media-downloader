"""Reddit API-keyless resolver module.
Extracts video (v.redd.it DASH video+audio), images (i.redd.it) and galleries
without requiring any Reddit developer API key or credentials.
"""
import re
import urllib.parse
import httpx

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
HEADERS = {"User-Agent": UA}

def normalize_reddit_url(url: str) -> str:
    url = url.strip()
    m_short = re.search(r"https?://(?:www\.)?redd\.it/([a-zA-Z0-9]+)", url, re.I)
    if m_short:
        return f"https://www.reddit.com/comments/{m_short.group(1)}/"
    m_v = re.search(r"https?://(?:www\.)?v\.redd\.it/([a-zA-Z0-9_-]+)", url, re.I)
    if m_v:
        return f"https://v.redd.it/{m_v.group(1)}"
    return url


def resolve_reddit_media(reddit_url: str) -> dict:
    reddit_url = normalize_reddit_url(reddit_url)

    # 1. Doğrudan v.redd.it URL'si girildiyse
    m_direct_v = re.match(r"^https?://v\.redd\.it/([a-zA-Z0-9_-]+)", reddit_url, re.I)
    if m_direct_v:
        v_id = m_direct_v.group(1)
        return _build_video_response(v_id, "Reddit Videosu", "", "")

    # 1.1 Doğrudan i.redd.it veya preview.redd.it URL'si girildiyse
    m_direct_img = re.match(r"^https?://(?:i|preview)\.redd\.it/([a-zA-Z0-9_.-]+)", reddit_url, re.I)
    if m_direct_img:
        img_file = m_direct_img.group(1).split("?")[0]
        ext = img_file.split(".")[-1].lower() if "." in img_file else "jpg"
        return {
            "status": "ok",
            "provider": "reddit",
            "title": f"Reddit Görseli ({img_file})",
            "uploader": "",
            "thumbnail": reddit_url,
            "is_photo": True,
            "direct_url": reddit_url,
            "qualities": [
                {
                    "id": "original",
                    "label": f"Orijinal Görsel ({ext.upper()})",
                    "direct_url": reddit_url,
                    "is_default": True
                }
            ],
            "audio_bitrates": []
        }

    # 2. oEmbed ile başlık ve metadata çekme
    title = "Reddit Medyası"
    author = ""
    thumbnail = ""
    try:
        oembed_url = f"https://www.reddit.com/oembed?url={urllib.parse.quote(reddit_url, safe='')}"
        r_oe = httpx.get(oembed_url, headers=HEADERS, timeout=5.0)
        if r_oe.status_code == 200:
            oe_data = r_oe.json()
            title = oe_data.get("title") or title
            author = oe_data.get("author_name") or ""
    except Exception:
        pass

    # 3. Resolver üzerinden v.redd.it veya i.redd.it tespiti
    v_id = None
    img_url = None
    try:
        rs_url = f"https://rapidsave.com/info?url={urllib.parse.quote(reddit_url, safe='')}"
        r_rs = httpx.get(rs_url, headers=HEADERS, timeout=8.0)
        if r_rs.status_code == 200:
            html = r_rs.text
            # Video tespiti
            m_vid = re.search(r"v\.redd\.it/([a-zA-Z0-9_-]+)", html)
            if m_vid:
                v_id = m_vid.group(1)
            # Görsel tespiti
            if not v_id:
                m_img = re.search(r'(https?://i\.redd\.it/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp|gif))', html)
                if m_img:
                    img_url = m_img.group(1)
            # Thumbnail tespiti
            m_thumb = re.search(r'(https?://[^\"]*(?:preview\.redd\.it|external-preview\.redd\.it)[^\"]*)', html)
            if m_thumb:
                thumbnail = m_thumb.group(1).replace("&amp;", "&")
    except Exception as exc:
        print(f"[REDDIT_RESOLVER] info error: {exc}", flush=True)

    # 4. Fotoğraf ise
    if img_url:
        ext = img_url.split(".")[-1].lower() if "." in img_url else "jpg"
        return {
            "status": "ok",
            "provider": "reddit",
            "title": title,
            "uploader": author,
            "thumbnail": thumbnail or img_url,
            "is_photo": True,
            "direct_url": img_url,
            "qualities": [
                {
                    "id": "original",
                    "label": f"Orijinal Görsel ({ext.upper()})",
                    "direct_url": img_url,
                    "is_default": True
                }
            ],
            "audio_bitrates": []
        }

    # 5. Video ise
    if v_id:
        return _build_video_response(v_id, title, author, thumbnail)

    return {"status": "error", "error": {"code": "reddit_failed", "message": "Reddit medya kaynağı bulunamadı veya gönderi silinmiş."}}


def _build_video_response(v_id: str, title: str, author: str, thumbnail: str) -> dict:
    v_base = f"https://v.redd.it/{v_id}"

    available_qualities = []
    for h in [1080, 720, 480, 360, 240]:
        v_test_url = f"{v_base}/DASH_{h}.mp4"
        try:
            r = httpx.head(v_test_url, headers=HEADERS, timeout=2.5)
            if r.status_code == 200:
                available_qualities.append({
                    "id": str(h),
                    "height": h,
                    "label": f"{h}p HD" if h >= 720 else f"{h}p",
                    "is_default": (len(available_qualities) == 0),
                    "video_url": v_test_url
                })
        except Exception:
            pass

    if not available_qualities:
        available_qualities.append({
            "id": "max",
            "height": 720,
            "label": "Orijinal Kalite",
            "is_default": True,
            "video_url": f"{v_base}/DASH_720.mp4"
        })

    # Ses kontrolü
    audio_url = None
    for a_test in [f"{v_base}/DASH_AUDIO_128.mp4", f"{v_base}/DASH_audio.mp4"]:
        try:
            r_a = httpx.head(a_test, headers=HEADERS, timeout=2.5)
            if r_a.status_code == 200:
                audio_url = a_test
                break
        except Exception:
            pass

    best_v = available_qualities[0]["video_url"]
    out_name = f"{title}.mp4"

    # En yüksek kalite için remux URL'si
    if audio_url:
        direct_remux_url = (
            f"/youtube-remux?video={urllib.parse.quote(best_v, safe='')}"
            f"&audio={urllib.parse.quote(audio_url, safe='')}"
            f"&filename={urllib.parse.quote(out_name, safe='')}"
        )
    else:
        direct_remux_url = (
            f"/youtube-remux?video={urllib.parse.quote(best_v, safe='')}"
            f"&mode=mute"
            f"&filename={urllib.parse.quote(out_name, safe='')}"
        )

    for q in available_qualities:
        v_url = q.get("video_url") or best_v
        if audio_url:
            q_remux = (
                f"/youtube-remux?video={urllib.parse.quote(v_url, safe='')}"
                f"&audio={urllib.parse.quote(audio_url, safe='')}"
                f"&filename={urllib.parse.quote(out_name, safe='')}"
            )
        else:
            q_remux = (
                f"/youtube-remux?video={urllib.parse.quote(v_url, safe='')}"
                f"&mode=mute"
                f"&filename={urllib.parse.quote(out_name, safe='')}"
            )
        q["direct_url"] = q_remux

    return {
        "status": "ok",
        "provider": "reddit",
        "title": title,
        "uploader": author,
        "thumbnail": thumbnail or "",
        "video_id": v_id,
        "has_audio": bool(audio_url),
        "audio_url": audio_url,
        "direct_url": direct_remux_url,
        "qualities": available_qualities,
        "audio_bitrates": [
            {"id": "320", "label": "En İyi Ses (MP3)", "is_default": True}
        ] if audio_url else []
    }
