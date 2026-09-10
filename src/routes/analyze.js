import { readJsonBody, sendJson, getClientIp } from '../utils/http.js';
import { isYouTubeUrl, isInstagramUrl, analyzeYouTube, resolveInstagramFallback } from '../services/ytdlp.js';
import { analyzeTikTok } from '../services/tiktok.js';
import { postCobalt } from '../services/cobalt.js';

export async function handleAnalyze(req, res) {
  try {
    const payload = await readJsonBody(req);
    const url = (payload.url || '').trim();
    const clientIp = getClientIp(req);

    if (!url) {
      return sendJson(res, 400, { status: 'error', message: 'URL gerekli' });
    }

    // 1. YouTube Analizi
    if (isYouTubeUrl(url)) {
      const { status, data } = await analyzeYouTube(url, clientIp);
      return sendJson(res, status, data);
    }

    // 2. TikTok Analizi
    if (/^https?:\/\/([\w-]+\.)?(tiktok\.com)\//i.test(url)) {
      const tikData = await analyzeTikTok(url);
      if (tikData) {
        return sendJson(res, 200, tikData);
      }
    }

    // 3. Generic / Cobalt Analizi (Instagram, Twitter, Reddit, SoundCloud vb.)
    let cData = null;
    try {
      const cobResult = await postCobalt({ url, downloadMode: 'auto', videoQuality: 'max' });
      cData = cobResult.data;
    } catch {}

    if (cData && cData.status === 'picker' && Array.isArray(cData.picker)) {
      return sendJson(res, 200, {
        status: 'ok',
        provider: 'picker',
        title: 'Çoklu Medya / Galeri',
        thumbnail: cData.picker[0]?.thumb || cData.picker[0]?.url || '',
        has_photos: true,
        photos: cData.picker.map((item, idx) => ({
          url: item.url,
          thumb: item.thumb || item.url,
          filename: `media_${idx + 1}.${item.type === 'video' ? 'mp4' : 'jpg'}`,
          type: item.type || 'photo'
        })),
        qualities: [],
        audio_bitrates: []
      });
    }

    if (cData && (cData.status === 'redirect' || cData.status === 'tunnel')) {
      return sendJson(res, 200, {
        status: 'ok',
        provider: 'generic',
        title: cData.filename || 'Medya Dosyası',
        thumbnail: '',
        direct_url: cData.url,
        qualities: [
          { id: 'max', label: 'Orijinal En Yüksek Kalite (MP4)', is_default: true, direct_url: cData.url }
        ],
        audio_bitrates: [
          { id: '320', label: 'En İyi Ses (MP3)', is_default: true }
        ]
      });
    }

    // 4. Instagram Fallback: cobalt'ın mobil API'si engellendiğinde GraphQL fallback
    if (isInstagramUrl(url)) {
      const igResult = await resolveInstagramFallback(url, clientIp);
      if (igResult) {
        return sendJson(res, 200, igResult);
      }
    }

    // 5. Varsayılan Fallback Format Seçenekleri
    return sendJson(res, 200, {
      status: 'ok',
      provider: 'generic',
      title: 'Sosyal Medya İçeriği',
      qualities: [
        { id: 'max', label: 'En Yüksek Kalite (Max)', is_default: true },
        { id: '1080', label: '1080p Full HD', is_default: false },
        { id: '720', label: '720p HD', is_default: false },
        { id: '480', label: '480p SD', is_default: false }
      ],
      audio_bitrates: [
        { id: '320', label: '320 kbps (En Yüksek)', is_default: true },
        { id: '128', label: '128 kbps (Standart)', is_default: false }
      ]
    });

  } catch (err) {
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
