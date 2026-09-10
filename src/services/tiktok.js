import { egressFetch } from './egress.js';

export async function proxyTikTokRaw(body) {
  const tikRes = await egressFetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    },
    body: body
  });
  return await tikRes.json();
}

export async function analyzeTikTok(url) {
  const formData = new URLSearchParams();
  formData.append('url', url);
  formData.append('hd', '1');

  const tikRes = await egressFetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    },
    body: formData.toString()
  });

  const tData = await tikRes.json();
  if (tData.code === 0 && tData.data) {
    const d = tData.data;
    const author = d.author?.unique_id || 'tiktok_user';
    const title = d.title || `TikTok Video by @${author}`;
    const isPhotoAlbum = d.images && Array.isArray(d.images) && d.images.length > 0;
    const durationSec = d.duration || 0;
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationStr = durationSec > 0 ? `${mins}:${secs < 10 ? '0' : ''}${secs}` : '';

    return {
      status: 'ok',
      provider: 'tiktok',
      title: title,
      thumbnail: d.cover || d.origin_cover || '',
      duration: durationSec,
      duration_str: durationStr,
      uploader: `@${author}`,
      has_photos: isPhotoAlbum,
      photos: isPhotoAlbum ? d.images.map((img, idx) => ({ url: img, filename: `tiktok_${author}_photo_${idx + 1}.jpg` })) : [],
      qualities: [
        { id: 'hd', label: 'HD MP4 (Filigransız En Yüksek)', is_default: true, direct_url: d.hdplay || d.play },
        { id: 'sd', label: 'SD MP4 (Filigransız)', is_default: false, direct_url: d.play }
      ],
      audio_bitrates: [
        { id: '320', label: 'Orijinal Ses (MP3)', is_default: true, direct_url: d.music }
      ]
    };
  }

  return null;
}
