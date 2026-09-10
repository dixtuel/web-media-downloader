import { ADSENSE_CLIENT_ID, ADSENSE_SLOTS } from '../config.js';
import { sendJson } from '../utils/http.js';

export function handleAdConfig(req, res) {
  sendJson(res, 200, {
    clientId: ADSENSE_CLIENT_ID || null,
    slots: {
      content: ADSENSE_SLOTS.content || null,
      railLeft: ADSENSE_SLOTS.railLeft || null,
      railRight: ADSENSE_SLOTS.railRight || null
    }
  }, { 'Cache-Control': 'no-cache' });
}
