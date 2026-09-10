import { Readable } from 'node:stream';
import { YTDLP_API } from '../config.js';
import { getClientIp, sanitizeFilenameHeader } from '../utils/http.js';

export function isYouTubeUrl(url) {
  return /^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(url);
}

export function isInstagramUrl(url) {
  return /^https?:\/\/(?:www\.)?instagram\.com\//i.test(url);
}

export async function analyzeWithYtdlp(url, clientIp) {
  const ytRes = await fetch(`${YTDLP_API}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Forwarded-For': clientIp || ''
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(35000)
  });
  const data = await ytRes.json();
  return { status: ytRes.status, data };
}
export const analyzeYouTube = analyzeWithYtdlp;

export async function extractWithYtdlp(rawBody, clientIp) {
  const ytRes = await fetch(`${YTDLP_API}/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Forwarded-For': clientIp || ''
    },
    body: rawBody,
    signal: AbortSignal.timeout(60000)
  });
  const data = await ytRes.json();
  return { status: ytRes.status, data };
}
export const extractYouTube = extractWithYtdlp;

export async function resolveInstagramFallback(url, clientIp) {
  try {
    const igRes = await fetch(`${YTDLP_API}/instagram-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': clientIp || '' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(25000)
    });
    const igData = await igRes.json();
    if (igData.status === 'ok' && igData.url) {
      return {
        status: 'ok',
        provider: 'generic',
        title: igData.title || igData.filename || 'Instagram Medyası',
        thumbnail: igData.thumbnail || '',
        direct_url: igData.url,
        qualities: [
          { id: 'max', label: igData.media_type === 'photo' ? 'Orijinal Görsel' : 'Orijinal En Yüksek Kalite (MP4)', is_default: true, direct_url: igData.url }
        ],
        audio_bitrates: igData.media_type === 'photo' ? [] : [
          { id: '320', label: 'En İyi Ses (MP3)', is_default: true }
        ]
      };
    }
  } catch {}
  return null;
}

export async function handleYouTubeRemux(req, res, parsedUrl) {
  const customFilename = (parsedUrl.searchParams.get('filename') || 'video.mp4').trim();
  const ext = (parsedUrl.searchParams.get('ext') || 'mp4').toLowerCase();
  const contentType = ext === 'webm' ? 'video/webm' : 'video/mp4';
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
    try {
      const clientIp = getClientIp(req);
      const targetUrl = `${YTDLP_API}/remux${parsedUrl.search}`;
      const remuxRes = await fetch(targetUrl, {
        method: 'GET',
        headers: { 'X-Forwarded-For': clientIp }
      });

      if (!remuxRes.ok) {
        res.writeHead(remuxRes.status, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(await remuxRes.text());
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store'
      });

      if (remuxRes.body) {
        Readable.fromWeb(remuxRes.body).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end(`Remux error: ${err.message}`);
    }
  }
}
