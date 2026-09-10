import { Readable } from 'node:stream';
import { egressFetch } from '../services/egress.js';
import { resolveMediaExtensionAndMime } from '../constants/mime.js';
import { sanitizeFilenameHeader, sendText } from '../utils/http.js';

export async function handleDownloadStream(req, res, parsedUrl) {
  const targetUrl = parsedUrl.searchParams.get('url');
  let targetFilename = (parsedUrl.searchParams.get('filename') || '').trim();

  if (!targetUrl) {
    return sendText(res, 400, 'Missing url parameter');
  }

  try {
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': targetUrl.includes('tiktok') ? 'https://www.tiktok.com/' : (targetUrl.includes('instagram') ? 'https://www.instagram.com/' : 'https://google.com/')
    };

    if (req.headers['range']) fetchHeaders['Range'] = req.headers['range'];
    if (req.headers['if-range']) fetchHeaders['If-Range'] = req.headers['if-range'];

    let fetchMethod = req.method;
    // Bazı CDN'ler (Google, TikTok) gövdesiz HEAD isteğinde Content-Length: 0 döner.
    // HEAD isteğinde Range yoksa bytes=0-0 GET ile sorgulayıp Content-Range'den toplam boyutu çekeriz.
    if (req.method === 'HEAD' && !fetchHeaders['Range']) {
      fetchMethod = 'GET';
      fetchHeaders['Range'] = 'bytes=0-0';
    }

    const mediaRes = await egressFetch(targetUrl, {
      method: fetchMethod,
      headers: fetchHeaders
    });

    if (!mediaRes.ok && mediaRes.status !== 206) {
      return sendText(res, mediaRes.status, `Failed to fetch media: ${mediaRes.statusText || mediaRes.status}`);
    }

    const upstreamContentType = mediaRes.headers.get('content-type');
    const { filename, contentType } = resolveMediaExtensionAndMime(targetUrl, targetFilename, upstreamContentType);

    const headers = {
      'Content-Type': contentType,
      'Content-Disposition': sanitizeFilenameHeader(filename),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Accept-Ranges': 'bytes'
    };

    let finalStatus = mediaRes.status;
    let contentLength = mediaRes.headers.get('content-length');
    let contentRange = mediaRes.headers.get('content-range');

    // İstemci yalın HEAD attıysa ve upstream'den 206 bytes 0-0/TOTAL geldiyse bunu 200 + TOTAL uzunluk olarak ilet
    if (req.method === 'HEAD' && !req.headers['range'] && contentRange) {
      finalStatus = 200;
      const total = contentRange.split('/')[1];
      if (total && total !== '*') contentLength = total;
      contentRange = null;
    }

    if (contentLength) headers['Content-Length'] = contentLength;
    if (contentRange) headers['Content-Range'] = contentRange;

    res.writeHead(finalStatus, headers);

    if (req.method !== 'HEAD' && mediaRes.body) {
      Readable.fromWeb(mediaRes.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end(`Stream error: ${err.message}`);
  }
}
