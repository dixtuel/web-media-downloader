export function getClientIp(req) {
  return req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '';
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', err => reject(err));
  });
}

export async function readJsonBody(req) {
  const body = await readBody(req);
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error('Geçersiz JSON verisi: ' + err.message);
  }
}

export function sendJson(res, statusCode, data, extraHeaders = {}) {
  if (res.headersSent) return;
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders
  });
  res.end(payload);
}

export function sendText(res, statusCode, text, extraHeaders = {}) {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders
  });
  res.end(text);
}

export function sanitizeFilenameHeader(filename) {
  const cleanAscii = (filename || 'download').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${cleanAscii}"; filename*=UTF-8''${encodeURIComponent(filename || 'download')}`;
}
