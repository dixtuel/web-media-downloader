import path from 'node:path';

export const STATIC_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

export const MEDIA_MIME_TYPES = {
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/x-m4v',
  '.3gp': 'video/3gpp',
  '.ts': 'video/mp2t',
  // Ses
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.mka': 'audio/x-matroska',
  // Fotoğraf / Görsel
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  // Altyazı / Metin
  '.vtt': 'text/vtt',
  '.srt': 'application/x-subrip',
  '.ttml': 'application/ttml+xml',
  '.lrc': 'text/plain; charset=utf-8',
  // Arşiv
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip'
};

export function getStaticMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return STATIC_MIME_TYPES[ext] || 'application/octet-stream';
}

export function resolveMediaExtensionAndMime(targetUrl, targetFilename, upstreamContentType) {
  let ext = path.extname(targetFilename || '').toLowerCase();
  if (!ext && targetUrl) {
    try {
      const uPath = new URL(targetUrl).pathname;
      ext = path.extname(uPath).toLowerCase();
    } catch {}
  }

  const cleanUpstreamMime = (upstreamContentType || '').split(';')[0].trim().toLowerCase();
  if (!ext && cleanUpstreamMime) {
    for (const [e, m] of Object.entries(MEDIA_MIME_TYPES)) {
      if (m.split(';')[0].trim() === cleanUpstreamMime) {
        ext = e;
        break;
      }
    }
  }

  if (!ext) {
    ext = '.mp4';
  }

  let finalFilename = targetFilename || `media_download${ext}`;
  if (!finalFilename.toLowerCase().endsWith(ext)) {
    finalFilename = `${finalFilename}${ext}`;
  }

  const contentType = MEDIA_MIME_TYPES[ext] || cleanUpstreamMime || 'application/octet-stream';
  return { ext, filename: finalFilename, contentType };
}
