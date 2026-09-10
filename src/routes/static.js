import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from '../config.js';
import { getStaticMimeType } from '../constants/mime.js';
import { sendText } from '../utils/http.js';

export async function handleStatic(req, res, pathname) {
  const safeRelativePath = path.normalize(pathname === '/' ? 'index.html' : pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safeRelativePath);

  // Path traversal koruması: PUBLIC_DIR dışına çıkış engellenir
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isFile()) {
      res.writeHead(200, {
        'Content-Type': getStaticMimeType(filePath),
        'Cache-Control': 'no-cache'
      });
      return fs.createReadStream(filePath).pipe(res);
    }
  } catch {}

  // Fallback to index.html
  filePath = path.join(PUBLIC_DIR, 'index.html');
  try {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(filePath).pipe(res);
  } catch {
    return sendText(res, 404, 'Not Found');
  }
}
