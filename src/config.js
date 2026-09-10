import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PUBLIC_DIR = path.resolve(__dirname, '..', 'html');
export const COBALT_API = process.env.COBALT_API || 'http://cobalt:9000';
export const YTDLP_API = process.env.YTDLP_API || 'http://ytdlp-service:5000';
export const PORT = Number(process.env.PORT) || 80;

export const EGRESS_ADAPTER = (process.env.EGRESS_ADAPTER || '').trim();

export const ADSENSE_CLIENT_ID = (process.env.ADSENSE_CLIENT_ID || '').trim();
export const ADSENSE_SLOTS = {
  content: (process.env.ADSENSE_SLOT_CONTENT || '').trim(),
  railLeft: (process.env.ADSENSE_SLOT_RAIL_LEFT || '').trim(),
  railRight: (process.env.ADSENSE_SLOT_RAIL_RIGHT || '').trim()
};
