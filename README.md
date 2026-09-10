# Web Media Downloader

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Live](https://img.shields.io/badge/Canlı-downloader.sely.tr-green.svg?style=flat-square)](https://downloader.sely.tr)

Sosyal medya platformlarından (YouTube, TikTok, Instagram, Twitter/X, Reddit, SoundCloud vb.) video, ses veya fotoğraf albümlerini reklamsız, filigransız ve ücretsiz indirmek için hazırlanmış açık kaynaklı bir web arayüzü.

Arka planda [cobalt](https://github.com/imputnet/cobalt) ve [yt-dlp](https://github.com/yt-dlp/yt-dlp) motorlarını birlikte kullanır. Biri takıldığında diğeri otomatik devreye girer.

Canlı çalışan örnek: **[downloader.sely.tr](https://downloader.sely.tr)**

---

## Özellikler

- **Sade ve Hızlı:** Gereksiz hiçbir şey yok, telefonda da bilgisayarda da tek tıkla çalışır.
- **Çoklu Platform:** YouTube, TikTok, Instagram, Twitter/X, Reddit, SoundCloud, Pinterest vb.
- **Video & Ses Formatları:**
  - Video (MP4) için kalite seçimi (1080p, 720p vb.)
  - Sadece ses indirme (MP3, M4A, Opus, WAV)
  - Sessiz video indirme seçeneği
- **Galeri & Albüm Desteği:** TikTok ve Instagram slaytlarını/fotoğraflarını tek tek veya topluca indirebilme.
- **İndirme Yöneticisi Uyumlu:** IDM, FDM gibi programlarla duraklatılıp devam ettirilebilir (Range desteği tamdır).
- **Çift Motorlu Yapı:** Cobalt'ın WAF/Cloudflare veya format nedeniyle tıkandığı durumlarda otomatik yt-dlp fallback mekanizması.

---

## Kendi Sunucunda Çalıştırma (Docker Compose)

En kolayı Docker Compose ile tek komutta ayağa kaldırmak:

1. Örnek yapılandırmayı kopyalayın:
   ```bash
   cp docker-compose.example.yml docker-compose.yml
   ```

2. İsteğe bağlı ortam değişkenlerini ayarlayın (özel port veya reklam kodu istemiyorsanız varsayılanlar yeterlidir):
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
├── server.js               # Node.js HTTP sunucusu ve API yönlendirmeleri
├── package.json            # Bağımlılıklar (undici)
├── src/
│   ├── config.js           # Port ve API ortam değişkenleri
│   ├── constants/mime.js   # MIME ve dosya uzantı tanımları
│   ├── utils/http.js       # HTTP istek ve JSON yardımcıları
│   ├── services/           # Cobalt, yt-dlp ve TikTok çözümleme servisleri
│   └── routes/             # Analiz, akış ve indirme endpoint'leri
├── html/
│   ├── index.html          # Web arayüzü
│   ├── app.js              # İstemci tarafı indirme/remux mantığı
│   ├── style.css           # Tasarım
│   ├── terms.html          # Kullanım Şartları
│   └── privacy.html        # Gizlilik Politikası
├── ytdlp-service/          # yt-dlp mikroservisi (Python/FastAPI)
├── docker-compose.example.yml
└── LICENSE                 # MIT
```

---

## Lisans ve Teşekkür

Bu proje bağımsız bir açık kaynak çalışmadır. Arka planda harika iş çıkaran [cobalt](https://github.com/imputnet/cobalt) ve [yt-dlp](https://github.com/yt-dlp/yt-dlp) projelerinden yararlanır.

MIT Lisansı ile tamamen ücretsiz ve özgürdür. İstediğiniz gibi kurabilir, değiştirebilir ve kullanabilirsiniz.
