import { Readable } from 'node:stream';
import { COBALT_API } from '../config.js';

export async function checkCobaltHealth() {
  const apiRes = await fetch(`${COBALT_API}/`);
  return await apiRes.json();
}

export async function postCobalt(rawBody) {
  const cobaltRes = await fetch(`${COBALT_API}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
    signal: AbortSignal.timeout(30000)
  });
  const data = await cobaltRes.json();
  return { status: cobaltRes.status, data };
}

export async function handleCobaltTunnel(req, res, pathname, search) {
  try {
    const targetTunnelUrl = `${COBALT_API}${pathname}${search || ''}`;
    const safeHeaders = {};
    for (const key of ['range', 'if-range', 'accept', 'accept-encoding']) {
      if (req.headers[key]) safeHeaders[key] = req.headers[key];
    }

    const tunnelRes = await fetch(targetTunnelUrl, {
      method: req.method,
      headers: safeHeaders
    });

    const forwardHeaders = {};
    for (const [key, val] of tunnelRes.headers.entries()) {
      if (key.toLowerCase() !== 'transfer-encoding') {
        forwardHeaders[key] = val;
      }
    }
    forwardHeaders['Access-Control-Allow-Origin'] = '*';
    forwardHeaders['Accept-Ranges'] = 'bytes';

    res.writeHead(tunnelRes.status, forwardHeaders);

    if (req.method !== 'HEAD' && tunnelRes.body) {
      Readable.fromWeb(tunnelRes.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end(`Tunnel error: ${err.message}`);
  }
}
