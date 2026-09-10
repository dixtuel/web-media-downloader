document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('urlInput');
  const pasteBtn = document.getElementById('pasteBtn');
  const submitBtn = document.getElementById('submitBtn');
  const downloadForm = document.getElementById('downloadForm');
  const resultContainer = document.getElementById('resultContainer');
  const backendStatus = document.getElementById('backendStatus');
  const statusDot = document.querySelector('.status-dot');
  const toast = document.getElementById('toast');

  let currentMedia = null;
  let activeTab = 'video'; // 'video', 'audio', 'mute', 'photos'

  // Toast Helper
  let toastTimer = null;
  function showToast(message, type = '') {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    toastTimer = setTimeout(() => {
      toast.className = 'toast';
    }, 4500);
  }

  // XSS sanitizers for user/upstream strings
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sanitizeMediaUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return '';
  }

  // Health check
  async function checkBackend() {
    try {
      const res = await fetch('/api/', { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.cobalt) {
          backendStatus.textContent = `v${data.cobalt.version || '11'}`;
          statusDot.style.backgroundColor = '#10b981';
          return;
        }
      }
      backendStatus.textContent = 'Aktif';
      statusDot.style.backgroundColor = '#10b981';
    } catch {
      backendStatus.textContent = 'Bağlantı Bekleniyor';
      statusDot.style.backgroundColor = '#f59e0b';
    }
  }
  checkBackend();

  let lastAnalyzedUrl = '';
  let inputDebounceTimer = null;

  function isValidUrl(string) {
    try {
      const url = new URL(string.trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  const inputPlatformIcon = document.getElementById('inputPlatformIcon');

  function updateInputIcon(url) {
    if (!inputPlatformIcon) return;
    const lower = (url || '').toLowerCase();
    let iconSvg = '';
    let iconColor = 'var(--text-muted)';

    if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
      iconColor = '#ef4444';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
    } else if (lower.includes('tiktok.com')) {
      iconColor = '#22d3ee';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`;
    } else if (lower.includes('instagram.com')) {
      iconColor = '#ec4899';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>`;
    } else if (lower.includes('twitter.com') || lower.includes('x.com')) {
      iconColor = '#38bdf8';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
    } else if (lower.includes('reddit.com') || lower.includes('redd.it')) {
      iconColor = '#f97316';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.197-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>`;
    } else if (lower.includes('soundcloud.com')) {
      iconColor = '#fb923c';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.56 8.87V17h9.76c1.48 0 2.68-1.2 2.68-2.68 0-1.44-1.13-2.61-2.55-2.68-.21-2.14-2.02-3.81-4.23-3.81-.59 0-1.15.12-1.66.34-.65-1.28-1.99-2.16-3.53-2.16-.17 0-.33.01-.47.04v2.82zm-2.05.95v7.18H10.5V9.45c-.34.11-.67.24-.99.37zm-2.05 1.05v6.13h.99v-6.5c-.33.11-.66.23-.99.37zm-2.05 1.15v4.98h.99v-5.35c-.33.11-.66.24-.99.37zm-2.05 1.15v3.83h.99V12.8c-.33.12-.66.24-.99.37zm-2.05 1.15v2.68h.99v-3.05c-.33.12-.66.24-.99.37z"/></svg>`;
    } else if (lower.includes('pinterest.com') || lower.includes('pin.it')) {
      iconColor = '#e11d48';
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0a12 12 0 0 0-4.37 23.18c-.06-.98-.12-2.49.02-3.56.14-.98.9-3.83.9-3.83s-.23-.46-.23-1.14c0-1.07.62-1.87 1.39-1.87.66 0 .97.49.97 1.08 0 .66-.42 1.65-.64 2.57-.18.77.38 1.39 1.14 1.39 1.37 0 2.42-1.44 2.42-3.53 0-1.84-1.32-3.13-3.22-3.13-2.35 0-3.73 1.76-3.73 3.58 0 .71.27 1.47.61 1.88.07.08.08.15.06.24-.07.28-.21.87-.24 1-.04.16-.13.19-.3.12-1.12-.52-1.82-2.16-1.82-3.47 0-2.83 2.06-5.43 5.93-5.43 3.11 0 5.53 2.22 5.53 5.18 0 3.09-1.95 5.58-4.66 5.58-.91 0-1.77-.47-2.06-1.03l-.56 2.14c-.2 1.01-.76 2.27-1.13 3.09A12 12 0 1 0 12 0z"/></svg>`;
    } else {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
    }

    inputPlatformIcon.style.color = iconColor;
    inputPlatformIcon.innerHTML = iconSvg;
  }

  // Paste button
  pasteBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && isValidUrl(text)) {
          urlInput.value = text.trim();
          updateInputIcon(urlInput.value);
          showToast('Bağlantı yapıştırıldı, analiz ediliyor...', 'success');
          triggerAnalyze();
          return;
        }
      }
      urlInput.focus();
      showToast('Lütfen panodaki bağlantıyı yapıştırın', '');
    } catch {
      urlInput.focus();
    }
  });

  // Native input paste event (Ctrl+V / Sağ Tık Yapıştır)
  urlInput.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (text && isValidUrl(text)) {
      urlInput.value = text.trim();
      updateInputIcon(urlInput.value);
      e.preventDefault();
      showToast('Bağlantı algılandı, analiz ediliyor...', 'success');
      triggerAnalyze();
    }
  });

  // Dynamic input change with auto-debounce
  urlInput.addEventListener('input', () => {
    clearTimeout(inputDebounceTimer);
    const val = urlInput.value.trim();
    updateInputIcon(val);
    if (val && isValidUrl(val) && val !== lastAnalyzedUrl) {
      inputDebounceTimer = setTimeout(() => {
        triggerAnalyze();
      }, 400);
    }
  });

  // Global paste handler (sayfanın herhangi bir yerinde Ctrl+V yapıldığında)
  document.addEventListener('paste', (e) => {
    if (document.activeElement === urlInput) return; // Zaten urlInput üzerinde
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (text && isValidUrl(text)) {
      urlInput.value = text.trim();
      updateInputIcon(urlInput.value);
      e.preventDefault();
      showToast('Bağlantı panodan alındı, analiz ediliyor...', 'success');
      triggerAnalyze();
    }
  });

  // URL normalizer: Creates clean download endpoint for iOS Safari, FDM & browsers
  function buildDownloadUrl(rawUrl, filename) {
    if (!rawUrl) return '';

    if (rawUrl.startsWith('/youtube-remux') || rawUrl.includes('/youtube-remux?')) {
      if (filename && !rawUrl.includes('filename=')) {
        const glue = rawUrl.includes('?') ? '&' : '?';
        return `${rawUrl}${glue}filename=${encodeURIComponent(filename)}`;
      }
      return rawUrl;
    }

    if (rawUrl.includes('/tunnel?') || rawUrl.startsWith('/tunnel')) {
      try {
        const parsed = new URL(rawUrl, window.location.origin);
        return `${window.location.origin}${parsed.pathname}${parsed.search}`;
      } catch {
        return rawUrl;
      }
    }

    if (rawUrl.startsWith('/download?') || rawUrl.startsWith('/media-stream?')) {
      return rawUrl;
    }

    return `/download?url=${encodeURIComponent(rawUrl)}&filename=${encodeURIComponent(filename || 'media_download.mp4')}`;
  }

  // Trigger download (forces native attachment prompt)
  function triggerDownload(url, filename) {
    const finalUrl = buildDownloadUrl(url, filename);
    const a = document.createElement('a');
    a.href = finalUrl;
    if (filename) a.download = filename;
    a.target = '_self';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Multi-item sequential download
  async function downloadAllItems(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    showToast(`${items.length} adet medya indiriliyor...`, 'success');
    for (let i = 0; i < items.length; i++) {
      triggerDownload(items[i].url, items[i].filename || `media_${i + 1}.jpg`);
      await new Promise(r => setTimeout(r, 600));
    }
  }

  // Helper: platform detector
  function getPlatformTag(url) {
    if (/(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(url)) return 'YouTube';
    if (/(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/i.test(url)) return 'TikTok';
    if (/(?:instagram\.com)/i.test(url)) return 'Instagram';
    if (/(?:twitter\.com|x\.com)/i.test(url)) return 'Twitter / X';
    if (/(?:reddit\.com)/i.test(url)) return 'Reddit';
    if (/(?:soundcloud\.com|sndcdn\.com)/i.test(url)) return 'SoundCloud';
    if (/(?:pinterest\.com|pin\.it)/i.test(url)) return 'Pinterest';
    return 'Medya';
  }

  // Form Submit / Analyze Trigger
  downloadForm.addEventListener('submit', (e) => {
    e.preventDefault();
    triggerAnalyze();
  });

  async function triggerAnalyze() {
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) {
      showToast('Lütfen bir video veya ses bağlantısı girin', 'error');
      return;
    }

    lastAnalyzedUrl = rawUrl;
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    resultContainer.style.display = 'none';

    try {
      showToast('Bağlantı analiz ediliyor...', '');
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl })
      });

      const data = await res.json();
      if (!res.ok || data.status === 'error') {
        throw new Error(data.error?.message || data.message || 'Medya analiz edilemedi.');
      }

      currentMedia = { ...data, rawUrl };
      const isAudioOnly = Boolean(
        currentMedia.is_audio_only ||
        currentMedia.provider === 'soundcloud' ||
        /(?:soundcloud\.com)/i.test(rawUrl) ||
        (!currentMedia.has_photos && (!currentMedia.qualities || currentMedia.qualities.length === 0))
      );
      currentMedia.is_audio_only = isAudioOnly;

      if (isAudioOnly) {
        activeTab = 'audio';
      } else if (currentMedia.is_photo) {
        activeTab = 'photo';
      } else if (currentMedia.is_gif) {
        activeTab = 'gif';
      } else if (currentMedia.has_photos && (!currentMedia.qualities || currentMedia.qualities.length === 0)) {
        activeTab = 'photos';
      } else {
        activeTab = 'video';
      }

      renderMediaCard(currentMedia);
      showToast('Medya hazır!', 'success');
    } catch (err) {
      console.warn('Analyze error:', err);
      showToast(err.message || 'Analiz sırasında hata oluştu', 'error');
      // Fallback single card with error message (XSS safe)
      resultContainer.innerHTML = `
        <div class="result-card-single">
          <div class="result-info">
            <span class="result-filename">${escapeHtml(rawUrl)}</span>
            <span class="result-tag" style="color: var(--bad);">⚠ ${escapeHtml(err.message || 'İçerik çözümlenemedi')}</span>
          </div>
        </div>
      `;
      resultContainer.style.display = 'block';
    } finally {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  }

  // Render the Analyzed Interactive Media Card (XSS Protected)
  function renderMediaCard(media) {
    const rawPlatform = getPlatformTag(media.rawUrl);
    const platform = escapeHtml(rawPlatform);
    const title = escapeHtml(media.title || 'Medya Dosyası');
    const author = escapeHtml(media.uploader || '');
    const duration = escapeHtml(media.duration_str || '');
    const rawThumb = sanitizeMediaUrl(media.thumbnail) || '/favicon.svg';
    const thumb = escapeAttr(rawThumb);

    const isAudioOnly = Boolean(
      media.is_audio_only ||
      media.provider === 'soundcloud' ||
      /(?:soundcloud\.com)/i.test(media.rawUrl)
    );

    const isPhoto = Boolean(media.is_photo);
    const isGif = Boolean(media.is_gif);

    const hasPhotos = media.has_photos || (media.photos && media.photos.length > 0);
    const qualities = media.qualities || [];

    const bitrates = media.audio_bitrates || [
      { id: '320', label: '320 kbps (En Yüksek)', is_default: true },
      { id: '256', label: '256 kbps' },
      { id: '128', label: '128 kbps (Standart)' }
    ];

    let tabsHtml = '';
    if (isAudioOnly) {
      tabsHtml = `
        <div class="format-tabs" style="grid-template-columns: 1fr;">
          <button type="button" class="format-tab-btn active" data-tab="audio">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
            <span>Ses / Müzik (MP3)</span>
          </button>
        </div>
      `;
    } else if (isPhoto) {
      tabsHtml = `
        <div class="format-tabs" style="grid-template-columns: 1fr;">
          <button type="button" class="format-tab-btn active" data-tab="photo">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            <span>Orijinal Görsel</span>
          </button>
        </div>
      `;
    } else if (isGif) {
      tabsHtml = `
        <div class="format-tabs" style="grid-template-columns: 1fr;">
          <button type="button" class="format-tab-btn active" data-tab="gif">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
            <span>Hareketli Görsel (GIF)</span>
          </button>
        </div>
      `;
    } else {
      tabsHtml = `
        <div class="format-tabs">
          <button type="button" class="format-tab-btn ${activeTab === 'video' ? 'active' : ''}" data-tab="video">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
            <span>Video (MP4)</span>
          </button>
          <button type="button" class="format-tab-btn ${activeTab === 'audio' ? 'active' : ''}" data-tab="audio">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
            <span>Ses (MP3)</span>
          </button>
          <button type="button" class="format-tab-btn ${activeTab === 'mute' ? 'active' : ''}" data-tab="mute">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
            <span>Sessiz Video</span>
          </button>
          ${hasPhotos ? `
          <button type="button" class="format-tab-btn ${activeTab === 'photos' ? 'active' : ''}" data-tab="photos">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            <span>Galeri / Foto (${media.photos.length})</span>
          </button>` : ''}
        </div>
      `;
    }

    let bodyHtml = '';

    if (activeTab === 'photo') {
      const qLabel = qualities[0]?.label || 'Orijinal Görsel';
      const dlUrl = media.direct_url || (qualities[0]?.direct_url) || media.thumbnail;
      bodyHtml = `
        <div class="format-panel">
          <div class="control-group">
            <label>Format</label>
            <div style="font-size:0.92rem;color:var(--text);padding:8px 0;font-weight:600;">${escapeHtml(qLabel)}</div>
          </div>
          <a href="${escapeAttr(sanitizeMediaUrl(dlUrl))}" download="${escapeAttr(media.title || 'gorsel.jpg')}" id="btnDoDownload" class="btn-primary-download" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Görseli İndir</span>
          </a>
        </div>
      `;
    } else if (activeTab === 'gif') {
      const dlUrl = media.direct_url || (qualities[0]?.direct_url) || media.thumbnail;
      bodyHtml = `
        <div class="format-panel">
          <div class="control-group">
            <label>Format</label>
            <div style="font-size:0.92rem;color:var(--text);padding:8px 0;font-weight:600;">Hareketli Görsel (GIF)</div>
          </div>
          <a href="${escapeAttr(sanitizeMediaUrl(dlUrl))}" download="${escapeAttr(media.title || 'hareketli.gif')}" id="btnDoDownload" class="btn-primary-download" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>GIF'i İndir</span>
          </a>
        </div>
      `;
    } else if (activeTab === 'video') {
      const qualityOptions = qualities.map(q => `<option value="${escapeAttr(q.id)}" ${q.is_default ? 'selected' : ''}>${escapeHtml(q.label)}</option>`).join('');
      bodyHtml = `
        <div class="format-panel">
          <div class="control-row">
            <div class="control-group">
              <label for="cardQualitySelect">Video Kalitesi</label>
              <select id="cardQualitySelect" class="custom-select">
                ${qualityOptions}
              </select>
            </div>
            <div class="control-group">
              <label for="cardCodecSelect">Video Kodek</label>
              <select id="cardCodecSelect" class="custom-select">
                <option value="h264" selected>Otomatik (En Uyumlu MP4 / H.264)</option>
                <option value="av1">AV1 (Yeni Nesil / Yüksek Verim)</option>
                <option value="vp9">VP9 (WebM / HD)</option>
              </select>
            </div>
          </div>
          <button type="button" id="btnDoDownload" class="btn-primary-download">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Videoyu İndir (MP4)</span>
          </button>
        </div>
      `;
    } else if (activeTab === 'audio') {
      const bitrateOptions = bitrates.map(b => `<option value="${escapeAttr(b.id)}" ${b.is_default ? 'selected' : ''}>${escapeHtml(b.label)}</option>`).join('');
      bodyHtml = `
        <div class="format-panel">
          <div class="control-row">
            <div class="control-group">
              <label for="cardBitrateSelect">Ses Bit Hızı</label>
              <select id="cardBitrateSelect" class="custom-select">
                ${bitrateOptions}
              </select>
            </div>
            <div class="control-group">
              <label for="cardAudioFormatSelect">Ses Formatı</label>
              <select id="cardAudioFormatSelect" class="custom-select">
                <option value="mp3" selected>MP3 (Evrensel / Önerilen)</option>
                <option value="m4a">M4A (AAC / Yüksek Kalite)</option>
                <option value="opus">Opus (Ultra Verimli)</option>
                <option value="wav">WAV (Kayıpsız / Raw)</option>
              </select>
            </div>
          </div>
          <button type="button" id="btnDoDownload" class="btn-primary-download">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Sesi İndir (MP3)</span>
          </button>
        </div>
      `;
    } else if (activeTab === 'mute') {
      const qualityOptions = qualities.map(q => `<option value="${escapeAttr(q.id)}" ${q.is_default ? 'selected' : ''}>${escapeHtml(q.label)}</option>`).join('');
      bodyHtml = `
        <div class="format-panel">
          <div class="control-group">
            <label for="cardQualitySelect">Video Kalitesi</label>
            <select id="cardQualitySelect" class="custom-select">
              ${qualityOptions}
            </select>
          </div>
          <button type="button" id="btnDoDownload" class="btn-primary-download">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Sessiz Videoyu İndir</span>
          </button>
        </div>
      `;
    } else if (activeTab === 'photos' && hasPhotos) {
      const itemsHtml = media.photos.map((item, idx) => {
        const itemFilename = item.filename || `photo_${idx + 1}.jpg`;
        const rawItemUrl = sanitizeMediaUrl(item.url);
        const itemDownloadUrl = buildDownloadUrl(rawItemUrl, itemFilename);
        const rawThumbUrl = sanitizeMediaUrl(item.thumb || item.url);
        return `
          <div class="picker-item">
            <span class="picker-badge">Foto #${idx + 1}</span>
            <img src="${escapeAttr(rawThumbUrl)}" alt="Fotoğraf ${idx + 1}" loading="lazy" />
            <div class="picker-item-action">
              <a href="${escapeAttr(itemDownloadUrl)}" class="btn-picker-download" download="${escapeAttr(itemFilename)}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                <span>İndir</span>
              </a>
            </div>
          </div>
        `;
      }).join('');

      bodyHtml = `
        <div class="format-panel">
          <div class="gallery-header">
            <span class="gallery-title">Fotoğraf Albümü (${media.photos.length} Öğe)</span>
            <button type="button" class="btn-download-all" id="btnDownloadAllPicker">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>Tümünü İndir</span>
            </button>
          </div>
          <div class="picker-grid">${itemsHtml}</div>
        </div>
      `;
    }

    resultContainer.innerHTML = `
      <div class="media-card">
        <div class="media-header">
          <div class="media-thumb-box">
            <img src="${thumb}" alt="Önizleme" onerror="this.src='/favicon.svg'" />
            <span class="platform-badge">${platform}</span>
            ${duration ? `<span class="duration-badge">${duration}</span>` : ''}
          </div>
          <div class="media-meta">
            <h2 class="media-title">${title}</h2>
            ${author ? `<span class="media-author">${author}</span>` : ''}
          </div>
        </div>
        ${tabsHtml}
        ${bodyHtml}
      </div>
    `;

    resultContainer.style.display = 'block';

    // Bind gallery download all button cleanly without window scope
    const downloadAllBtn = document.getElementById('btnDownloadAllPicker');
    if (downloadAllBtn && media.photos) {
      downloadAllBtn.addEventListener('click', () => downloadAllItems(media.photos));
    }

    // Bind tab clicks
    resultContainer.querySelectorAll('.format-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        renderMediaCard(currentMedia);
      });
    });

    // Bind Download Action
    const doDownloadBtn = document.getElementById('btnDoDownload');
    if (doDownloadBtn) {
      doDownloadBtn.addEventListener('click', async () => {
        const qualityVal = document.getElementById('cardQualitySelect')?.value || 'max';
        const codecVal = document.getElementById('cardCodecSelect')?.value || 'h264';
        const bitrateVal = document.getElementById('cardBitrateSelect')?.value || '320';
        const audioFormatVal = document.getElementById('cardAudioFormatSelect')?.value || 'mp3';

        await executeDownload({
          mode: activeTab,
          quality: qualityVal,
          codec: codecVal,
          bitrate: bitrateVal,
          audioFormat: audioFormatVal
        });
      });
    }
  }

  // Execute Final Download Stream
  async function executeDownload(options) {
    if (!currentMedia) return;

    const btn = document.getElementById('btnDoDownload');
    if (btn) {
      btn.classList.add('loading');
      btn.innerHTML = '<span>İndirme Hazırlanıyor...</span>';
    }

    try {
      showToast('İndirme hazırlanıyor...', '');

      // YouTube, Reddit, Twitter, SoundCloud, Pinterest veya yt-dlp üzerinden çözülen platformlar
      const isYtdlpSupported = Boolean(
        currentMedia.is_audio_only ||
        ['youtube', 'reddit', 'twitter', 'soundcloud', 'pinterest'].includes(currentMedia.provider) ||
        /(?:youtube\.com|youtu\.be|music\.youtube\.com|soundcloud\.com|on\.soundcloud\.com)/i.test(currentMedia.rawUrl)
      );

      if (isYtdlpSupported) {
        const payload = {
          url: currentMedia.rawUrl,
          downloadMode: options.mode === 'audio' ? 'audio' : (options.mode === 'mute' ? 'mute' : 'auto'),
          videoQuality: options.quality,
          vQuality: options.quality,
          youtubeVideoCodec: options.codec,
          vCodec: options.codec,
          audioFormat: options.audioFormat,
          aFormat: options.audioFormat,
          audioBitrate: options.bitrate
        };

        const res = await fetch('/youtube-extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok || data.status === 'error') {
          throw new Error(data.error?.message || 'İndirme linki oluşturulamadı.');
        }

        triggerDownload(data.url, data.filename);
        showToast('İndirme başlatıldı!', 'success');
        return;
      }

      // TikTok Direct
      if (currentMedia.provider === 'tiktok') {
        let directUrl = null;
        let ext = options.mode === 'audio' ? 'mp3' : 'mp4';
        let filename = `${currentMedia.title || 'tiktok_media'}.${ext}`;

        if (options.mode === 'audio') {
          directUrl = currentMedia.audio_bitrates?.[0]?.direct_url;
        } else {
          const qObj = currentMedia.qualities?.find(q => q.id === options.quality) || currentMedia.qualities?.[0];
          directUrl = qObj?.direct_url;
        }

        if (directUrl) {
          triggerDownload(directUrl, filename);
          showToast('İndirme başlatıldı!', 'success');
          return;
        }
      }

      // Generic / Cobalt API (Instagram, Twitter, Reddit, SoundCloud vb.)
      const payload = {
        url: currentMedia.rawUrl,
        downloadMode: options.mode === 'audio' ? 'audio' : (options.mode === 'mute' ? 'mute' : 'auto'),
        videoQuality: options.quality,
        vQuality: options.quality,
        youtubeVideoCodec: options.codec,
        vCodec: options.codec,
        audioFormat: options.audioFormat,
        aFormat: options.audioFormat,
        audioBitrate: options.bitrate
      };

      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || data.status === 'error') {
        throw new Error(data.error?.message || data.text || 'İndirme linki oluşturulamadı.');
      }

      if (data.status === 'redirect' || data.status === 'tunnel') {
        triggerDownload(data.url, data.filename);
        showToast('İndirme başlatıldı!', 'success');
      } else if (data.status === 'picker' && Array.isArray(data.picker)) {
        currentMedia.photos = data.picker.map((item, idx) => ({
          url: item.url,
          thumb: item.thumb || item.url,
          filename: `media_${idx + 1}.${item.type === 'video' ? 'mp4' : 'jpg'}`
        }));
        currentMedia.has_photos = true;
        activeTab = 'photos';
        renderMediaCard(currentMedia);
        showToast('Galeri yüklendi!', 'success');
      }
    } catch (err) {
      console.warn('Download execution error:', err);
      showToast(err.message || 'İndirme sırasında hata oluştu', 'error');
    } finally {
      if (btn) {
        btn.classList.remove('loading');
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>${options.mode === 'audio' ? 'Sesi İndir (MP3)' : 'Videoyu İndir (MP4)'}</span>`;
      }
    }
  }
});
