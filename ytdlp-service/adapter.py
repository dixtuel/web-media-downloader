"""Downloader — Shared egress adapter (mitmproxy addon).

yt-dlp'nin ve cobalt/cobalt-web'in ağ katmanı standart bir HTTP/HTTPS
(CONNECT) proxy bekliyor. Deno Deploy ve AWS Lambda ise yalnız ayrık istek/
yanıt (request/response) destekliyor, ham CONNECT tünellemesi yapamıyor
(2026-08-23'te canlıda doğrulandı — bkz. proje CLAUDE.md, "YouTube Desteği").

Bu adaptör bu ikisi arasında köprü kurar: mitmproxy'yi (bu konteynerin
içinde, Docker'ın iç ağında `ytdlp-service:8888` olarak erişilebilen, host'a
hiç açılmayan) gerçek bir CONNECT-destekli proxy olarak çalıştırır — TLS'i
yerel olarak sonlandırır, isteği düz metin olarak görür — sonra bu isteği
relé'ye header-tabanlı (x-target-host) bir istek/yanıt olarak iletir.
İstemcinin (yt-dlp/cobalt/cobalt-web) gördüğü: sıradan bir HTTP proxy.
Relé'nin gördüğü: sıradan bir POST isteği. Aradaki köprü burası.

Yalnız YouTube değil — TikTok/Instagram/Twitter gibi platformların da
datacenter IP'lerini YouTube'dan daha agresif/anında bloke ettiği
araştırmayla doğrulandığı için (2026-08-23) `cobalt` ve `cobalt-web`
(tikwm.com çözümleyicisi) konteynerleri de bu adaptörü kullanır.

Rota seçimi: her istek için 2 direkt : 4 relé dağılımına göre bir *tercih
edilen* rota seçilir (relé'ler arası eşit bölünür, aylık kota dolarsa o
relé o ay devre dışı kalır). Bununla YETİNİLMEZ — tercih edilen rota
gerçekten BAŞARISIZ olursa (bağlantı hatası veya 5xx), sabit bir zincirle
sırayla diğerleri denenir: direkt (VDS IP) → Deno → Lambda. Yani rotasyon
normal dağıtım için, zincir ise dayanıklılık (resilience) için — biri
diğerinin yerine geçmez.
"""
import itertools
import os
import threading
import time
import urllib.parse

import httpx
from mitmproxy import http

DENO_RELAY_URL = (os.environ.get("DENO_RELAY_URL") or "").rstrip("/")
DENO_RELAY_SECRET = os.environ.get("DENO_RELAY_SECRET") or ""
LAMBDA_RELAY_URL = (os.environ.get("LAMBDA_RELAY_URL") or "").rstrip("/")
LAMBDA_RELAY_SECRET = os.environ.get("LAMBDA_RELAY_SECRET") or ""

# Free-tier limitlerinin altında güvenli bir pay bırakır (Deno Deploy ~1M
# istek/ay, AWS Lambda free tier 1M istek/ay). Gerekirse env ile değiştirilir.
DENO_MONTHLY_LIMIT = int(os.environ.get("DENO_MONTHLY_LIMIT", "900000"))
LAMBDA_MONTHLY_LIMIT = int(os.environ.get("LAMBDA_MONTHLY_LIMIT", "900000"))

if LAMBDA_RELAY_URL and DENO_RELAY_URL:
    _PATTERN = ("deno", "lambda")
elif DENO_RELAY_URL:
    _PATTERN = ("deno",)
elif LAMBDA_RELAY_URL:
    _PATTERN = ("lambda",)
else:
    _PATTERN = ("direct",)

# Bir rota başarısız olduğunda veya kotası dolduğunda denenecek sıra:
# Deno <-> Lambda arası yedekleme, ikisi de dolarsa veya hata verirse idareten Direkt (VDS IP).
_FALLBACK_ORDER = ("deno", "lambda", "direct")

_counter = itertools.count()
_lock = threading.Lock()

_usage: dict[str, dict] = {
    "deno": {"month": "", "count": 0},
    "lambda": {"month": "", "count": 0},
}


def _current_month() -> str:
    return time.strftime("%Y-%m")


def _quota_ok(name: str, limit: int) -> bool:
    with _lock:
        state = _usage[name]
        month = _current_month()
        if state["month"] != month:
            state["month"] = month
            state["count"] = 0
        return state["count"] < limit


def _quota_bump(name: str) -> None:
    with _lock:
        state = _usage[name]
        month = _current_month()
        if state["month"] != month:
            state["month"] = month
            state["count"] = 0
        state["count"] += 1


def _preferred_route() -> str:
    if DENO_RELAY_URL and _quota_ok("deno", DENO_MONTHLY_LIMIT):
        return "deno"
    if LAMBDA_RELAY_URL and _quota_ok("lambda", LAMBDA_MONTHLY_LIMIT):
        return "lambda"
    return "direct"


def _route_available(route: str) -> bool:
    if route == "direct":
        return True
    if route == "deno":
        return bool(DENO_RELAY_URL) and _quota_ok("deno", DENO_MONTHLY_LIMIT)
    if route == "lambda":
        return bool(LAMBDA_RELAY_URL) and _quota_ok("lambda", LAMBDA_MONTHLY_LIMIT)
    return False


def _attempt_order(host: str = "") -> list[str]:
    # Yerel / iç Docker ağı servisleri (pot-provider, localhost vb.)
    # relé'lere gitmemeli — doğrudan yerel ağda çözülmeli.
    if any(h in host.lower() for h in ("pot-provider", "localhost", "127.0.0.1", "ytdlp", "cobalt")):
        return ["direct"]

    # VDS IP'si doğrudan ve anında (0ms proxy gecikmesiyle) çalışır.
    # Başarısız olursa (403 bot engeli, 429 rate-limit veya 5xx), otomatik olarak
    # röleye (Lambda / Deno) fallback yapar.
    order = ["direct", "lambda", "deno"]
    return [r for r in order if _route_available(r)]


def _target_base(req) -> str:
    base = f"{req.scheme}://{req.host}"
    if req.port not in (80, 443):
        base += f":{req.port}"
    return base


def _clean_path(p: str) -> str:
    if p.startswith("http://") or p.startswith("https://"):
        parsed = urllib.parse.urlparse(p)
        p = parsed.path or "/"
        if parsed.query:
            p += f"?{parsed.query}"
    if not p.startswith("/"):
        p = "/" + p
    return p


def _do_direct(req) -> httpx.Response:
    headers = dict(req.headers)
    headers.pop("host", None)
    headers.pop("proxy-connection", None)
    return httpx.request(
        req.method, f"{_target_base(req)}{_clean_path(req.path)}", headers=headers, content=req.content, timeout=12.0, trust_env=False
    )


def _do_relay(req, route: str) -> httpx.Response:
    relay_base, relay_secret = (
        (DENO_RELAY_URL, DENO_RELAY_SECRET) if route == "deno" else (LAMBDA_RELAY_URL, LAMBDA_RELAY_SECRET)
    )
    headers = dict(req.headers)
    headers.pop("host", None)
    headers.pop("proxy-connection", None)
    headers["x-target-host"] = _target_base(req)
    headers["x-proxy-secret"] = relay_secret
    return httpx.request(
        req.method, f"{relay_base}{_clean_path(req.path)}", headers=headers, content=req.content, timeout=12.0, trust_env=False
    )


class RelayAdapter:
    def request(self, flow: http.HTTPFlow) -> None:
        req = flow.request
        last_err = None

        for route in _attempt_order(req.host):
            try:
                resp = _do_direct(req) if route == "direct" else _do_relay(req, route)
                print(f"[ADAPTER] route={route} status={resp.status_code} {req.method} {_target_base(req)}{_clean_path(req.path)}", flush=True)
                # 5xx sunucu hatası, 429 (hız limiti / bot engeli), 403 (WAF engeli) veya 404 (bölge/blok engeli) durumunda
                # bir sonraki rotaya (Direct -> Deno -> Lambda) geç
                if resp.status_code >= 500 or resp.status_code in (403, 404, 429):
                    last_err = f"HTTP {resp.status_code} ({route})"
                    continue
                # httpx gövdeyi otomatik açtığından (decompress) ve content-length değişebileceğinden,
                # bu başlıkları mitmproxy yanıtından temizle — istemciye (yt-dlp/cobalt) temiz baytlar iletilsin.
                resp_headers = {
                    k: v for k, v in resp.headers.items()
                    if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")
                }
                flow.response = http.Response.make(resp.status_code, resp.content, resp_headers)
                if route != "direct":
                    _quota_bump(route)
                return
            except Exception as exc:
                last_err = f"{route}: {exc}"
                continue

        flow.response = http.Response.make(502, f"tum rotalar basarisiz: {last_err}".encode())


addons = [RelayAdapter()]
