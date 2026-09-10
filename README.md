# Cobalt Web UI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Canlı-downloader.sely.tr-green.svg?style=flat-square)](https://downloader.sely.tr)

[cobalt](https://github.com/imputnet/cobalt) API'si için hafif, modern ve kullanımı kolay bir web arayüzü. 

Sosyal medya platformlarından (YouTube, TikTok, Instagram, Twitter/X vb.) video, ses veya fotoğraf albümü indirmek için geliştirilmiş tamamen açık kaynaklı ve ücretsiz bir projedir.

Canlı çalışan örnek: **[downloader.sely.tr](https://downloader.sely.tr)**

---

## Neler Yapabilir?

- **Hafif ve Hızlı:** Sade tasarım, hızlı yükleme, mobilde ve masaüstünde tam uyum.
- **Çoklu Platform:** YouTube, TikTok, Instagram, Twitter/X, Reddit, SoundCloud vb.
- **Format Seçenekleri:**
  - Video (MP4) için kalite seçimi (1080p, 720p vb.) ve kodek seçenekleri.
  - Sadece ses (MP3, M4A, Opus, WAV) indirme seçeneği.
  - Sessiz video (mute) indirme.
- **Galeri & Albüm Desteği:** TikTok ve Instagram'daki çoklu fotoğraflı içerikleri tek tek veya topluca indirebilme.
- **İndirme Yöneticisi Desteği:** IDM, FDM gibi programlarla duraklatıp devam ettirilebilir (Range/HEAD başlıkları düzgün iletilir).
- **Gelişmiş YouTube Desteği:** Cobalt'ın takıldığı YouTube kısıtlamaları için arkada çalışan opsiyonel yt-dlp mikroservisi.

---

## Nasıl Çalıştırılır? (Docker Compose)

En pratik yol Docker Compose ile ayağa kaldırmaktır.

1. Örnek compose dosyasını kopyalayın:
   ```bash
   cp docker-compose.example.yml docker-compose.yml
   ```

2. İsteğe bağlı ortam değişkenlerini ayarlayın (reklam veya özel port istemiyorsanız varsayılanlar yeterlidir):
   ```bash
   cp .env.example .env
   ```

3. Başlatın:
   ```bash
   docker compose up -d
   ```

Arayüze tarayıcınızdan **`http://localhost:8081`** adresinden erişebilirsiniz.

---

## Proje Yapısı

```text
.
├── server.js               # Node.js HTTP sunucusu ve route orkestrasyonu
├── package.json            # Bağımlılıklar (undici)
├── src/
│   ├── config.js           # Port ve API ortam değişkenleri
│   ├── constants/mime.js   # MIME ve dosya uzantı tanımları
│   ├── utils/http.js       # Gövde okuma, başlık ve JSON yardımcıları
│   ├── services/           # Cobalt, yt-dlp, TikTok ve Egress servisleri
│   └── routes/             # Analiz, akış/indirme ve statik route'lar
├── html/
│   ├── index.html          # Ana sayfa
│   ├── app.js              # İstemci arayüz mantığı (XSS korumalı)
│   ├── style.css           # Tasarım stilleri
│   ├── terms.html          # Kullanım Şartları
│   └── privacy.html        # Gizlilik Politikası
├── ytdlp-service/          # YouTube için yt-dlp mikroservisi (opsiyonel)
├── docker-compose.example.yml
└── LICENSE                 # MIT
```

---

## Lisans ve Kredi

Bu proje [imputnet/cobalt](https://github.com/imputnet/cobalt) ekibinden bağımsız, açık kaynak API'sini kullanan ücretsiz bir topluluk arayüzüdür.

MIT Lisansı ile korunur — dilediğiniz gibi kullanabilir, değiştirebilir ve self-host edebilirsiniz.
