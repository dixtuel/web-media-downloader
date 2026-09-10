import http from 'node:http';
import { YTDLP_API } from '../config.js';
import { getClientIp, sanitizeFilenameHeader } from '../utils/http.js';

export function isYouTubeUrl(url) {
  return /^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(url);
}

export function isInstagramUrl(url) {
  return /^https?:\/\/(?:www\.)?instagram\.com\//i.test(url);
}

function requestYtdlp(endpoint, { method = 'POST', headers = {}, body = null, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(endpoint, YTDLP_API);
    const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const reqHeaders = {
      'Accept': 'application/json',
      ...headers
    };
    if (postData) {
      if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: target.hostname,
      port: target.port || 5000,
      path: target.pathname + target.search,
      method,
      headers: reqHeaders,
      agent: false, // Connection pool deadlock'larını engellemek için her istekte taze soket
      timeout
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(responseBody);
          resolve({ status: res.statusCode, data });
        } catch {
          resolve({ status: res.statusCode, data: { status: 'error', error: { message: responseBody || 'Invalid JSON response' } } });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Ytdlp request timed out after ${timeout}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

export async function analyzeWithYtdlp(url, clientIp) {
  return requestYtdlp('/analyze', {
    method: 'POST',
    headers: { 'X-Forwarded-For': clientIp || '' },
    body: { url },
    timeout: 35000
  });
}
export const analyzeYouTube = analyzeWithYtdlp;

export async function extractWithYtdlp(rawBody, clientIp) {
  return requestYtdlp('/extract', {
    method: 'POST',
    headers: { 'X-Forwarded-For': clientIp || '' },
    body: rawBody,
    timeout: 60000
  });
}
export const extractYouTube = extractWithYtdlp;

export async function resolveInstagramFallback(url, clientIp) {
  try {
    const { status, data } = await requestYtdlp('/instagram-extract', {
      method: 'POST',
      headers: { 'X-Forwarded-For': clientIp || '' },
      body: { url },
      timeout: 25000
    });
    if (status === 200 && data.status === 'ok' && data.url) {
      return {
        status: 'ok',
        provider: 'generic',
        title: data.title || data.filename || 'Instagram Medyası',
        thumbnail: data.thumbnail || '',
        direct_url: data.url,
        qualities: [
          { id: 'max', label: data.media_type === 'photo' ? 'Orijinal Görsel' : 'Orijinal En Yüksek Kalite (MP4)', is_default: true, direct_url: data.url }
        ],
        audio_bitrates: data.media_type === 'photo' ? [] : [
          { id: '320', label: 'En İyi Ses (MP3)', is_default: true }
        ]
      };
    }
  } catch {}
  return null;
}

export async function handleYouTubeRemux(req, res, parsedUrl) {
  const customFilename = (parsedUrl.searchParams.get('filename') || 'media.mp4').trim();
  const ext = (parsedUrl.searchParams.get('ext') || 'mp4').toLowerCase();
  const format = (parsedUrl.searchParams.get('format') || ext).toLowerCase();
  
  let contentType = 'video/mp4';
  if (format === 'mp3') contentType = 'audio/mpeg';
  else if (format === 'opus') contentType = 'audio/opus';
  else if (format === 'wav') contentType = 'audio/wav';
  else if (format === 'm4a') contentType = 'audio/mp4';
  else if (ext === 'webm') contentType = 'video/webm';

  const disposition = sanitizeFilenameHeader(customFilename);

  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache, no-store'
    });
    return res.end();
  }

  if (req.method === 'GET') {
    const clientIp = getClientIp(req);
    const target = new URL(`/remux${parsedUrl.search}`, YTDLP_API);

    const options = {
      hostname: target.hostname,
      port: target.port || 5000,
      path: target.pathname + target.search,
      method: 'GET',
      headers: { 'X-Forwarded-For': clientIp || '' },
      agent: false
    };

    const upstreamReq = http.request(options, (upstreamRes) => {
      if (upstreamRes.statusCode >= 400) {
        res.writeHead(upstreamRes.statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
        upstreamRes.pipe(res);
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store'
      });

      upstreamRes.pipe(res);
    });

    upstreamReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end(`Remux error: ${err.message}`);
    });

    upstreamReq.end();
  }
}

