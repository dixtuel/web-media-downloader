import http from 'node:http';
import { PORT } from './src/config.js';
import { readBody, sendJson, getClientIp } from './src/utils/http.js';
import { checkCobaltHealth, postCobalt, handleCobaltTunnel } from './src/services/cobalt.js';
import { proxyTikTokRaw } from './src/services/tiktok.js';
import { extractYouTube, handleYouTubeRemux } from './src/services/ytdlp.js';
import { handleAdConfig } from './src/routes/adConfig.js';
import { handleAnalyze } from './src/routes/analyze.js';
import { handleDownloadStream } from './src/routes/download.js';
import { handleStatic } from './src/routes/static.js';

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. AdSense yapılandırması
  if (pathname === '/ad-config.json') {
    return handleAdConfig(req, res);
  }

  // 2. Health check / status
  if (pathname === '/api/' || pathname === '/api') {
    try {
      const data = await checkCobaltHealth();
      return sendJson(res, 200, data);
    } catch {
      return sendJson(res, 502, { error: 'Cobalt backend offline' });
    }
  }

  // 3. TikTok API doğrudan proxy
  if (pathname === '/tiktok-api/' || pathname === '/tiktok-api') {
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const data = await proxyTikTokRaw(body);
        return sendJson(res, 200, data);
      } catch (err) {
        return sendJson(res, 500, { code: -1, msg: err.message });
      }
    }
  }

  // 4. Evrensel URL Analiz ve Format Sorgulama
  if (pathname === '/api/analyze' && req.method === 'POST') {
    return handleAnalyze(req, res);
  }

  // 5. Medya Akış Proxy'si (iOS Safari, FDM, IDM vb. için doğrudan indirme)
  if (pathname === '/download' || pathname === '/media-stream') {
    return handleDownloadStream(req, res, parsedUrl);
  }

  // 6. Cobalt Tunnel Proxy
  if (pathname === '/tunnel' || pathname.startsWith('/tunnel/')) {
    return handleCobaltTunnel(req, res, pathname, parsedUrl.search);
  }

  // 7. YouTube extraction proxy (ytdlp-service)
  if (req.method === 'POST' && pathname === '/youtube-extract') {
    try {
      const clientIp = getClientIp(req);
      const rawBody = await readBody(req);
      const { status, data } = await extractYouTube(rawBody, clientIp);
      return sendJson(res, status, data);
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: { code: 'ytdlp.backend.error', message: err.message } });
    }
  }

  // 8. YouTube remux stream proxy
  if (pathname === '/youtube-remux') {
    return handleYouTubeRemux(req, res, parsedUrl);
  }

  // 9. Cobalt API POST proxy
  if (req.method === 'POST' && pathname === '/') {
    try {
      const rawBody = await readBody(req);
      const { status, data } = await postCobalt(rawBody);
      return sendJson(res, status, data);
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: { code: 'backend.error', message: err.message } });
    }
  }

  // 10. Statik Dosya Sunumu
  return handleStatic(req, res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cobalt Web & Stream proxy running on port ${PORT}`);
});
