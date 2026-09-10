import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { EGRESS_ADAPTER } from '../config.js';

export const egressAgent = EGRESS_ADAPTER ? new ProxyAgent(EGRESS_ADAPTER) : null;

export function egressFetch(url, opts = {}) {
  return egressAgent ? undiciFetch(url, { ...opts, dispatcher: egressAgent }) : fetch(url, opts);
}
