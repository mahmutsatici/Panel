# CLAUDE.md

Panel: Electron tabanlı kişisel masaüstü paneli (saat, hava durumu, yapılacaklar, takvim, istatistik, Markdown notlar, çöp kutusu).

Aşağıdaki davranış ilkeleri [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) reposundan uyarlanmıştır. Önlerinde hız değil dikkat vardır; önemsiz işlerde yargı kullan.

## Mimari

- `main.js`: Electron ana süreç (pencere, tray, IPC, yedekleme, zamanlanmış bildirimler, otomatik başlatma).
- `preload.js`: ana süreç ile arayüz arasındaki tek köprü. Yeni IPC kanalı burada ve `registerIpc()` içinde birlikte eklenir.
- `src/index.html`, `src/styles.css`, `src/app.js`: arayüz kabuğu ve giriş noktası.
- `src/js/`: özellik başına bir modül (`core`, `layout`, `clock`, `weather`, `todos`, `calendar`, `stats`, `notes`, `trash`, `settings`). `core.js` ortak yardımcıları barındırır.
- `scripts/build.js`: esbuild ile paketleme. `scripts/editor-entry.js` not editörünün giriş noktası.
- Veri dosyaları (`todo.md`, `settings.json`, not dosyaları) Markdown/JSON olarak diskte tutulur; biçimlerini bozma.

## Komutlar

- `npm run build`: paketler. Değişiklik sonrası asgari doğrulama budur.
- `npm start`: build + uygulamayı açar (elle doğrulama).
- `npm run dist`: Windows NSIS kurulum paketi (`dist/v<sürüm>/` klasörüne).
- `npm run backup`: veri klasörünü seçili yedekleme klasörüne (`Panel yedekleri/islem-oncesi/…`) kopyalar. `npm run dist` bunu kendiliğinden çalıştırır.
- Otomatik test yok; "doğrulama" = build hatasız geçer + ilgili özellik uygulamada denenir.

## 1. Kodlamadan önce düşün

- Varsayımlarını açıkça yaz. Emin değilsen sor.
- Birden fazla yorum varsa sessizce birini seçme, sun.
- Daha basit bir yol varsa söyle; gerekiyorsa itiraz et.
- Belirsiz bir şey varsa dur, neyin belirsiz olduğunu söyle.

## 2. Önce sadelik

- İstenenin ötesinde özellik yok.
- Tek kullanımlık kod için soyutlama yok.
- İstenmemiş "esneklik" veya ayar seçeneği yok.
- Olması imkansız durumlar için hata yönetimi yok.
- 200 satır yazdıysan ve 50 olabilirse, yeniden yaz.
- Yeni bağımlılık ekleme; mevcut olanlar (`marked`, `dompurify`, `@fontsource-variable/inter`, esbuild) yetmiyorsa önce sor.

## 3. Cerrahi değişiklik

- Bitişik kodu, yorumları veya biçimlendirmeyi "iyileştirme".
- Bozuk olmayanı refactor etme.
- Kendi tercihin farklı olsa bile mevcut stile uy (modül yapısı, adlandırma, yorum yoğunluğu).
- İlgisiz ölü kod görürsen belirt, silme.
- Yalnızca KENDİ değişikliğinin sahipsiz bıraktığı import/değişken/fonksiyonu temizle.
- Sınav: değiştirilen her satır doğrudan kullanıcının isteğine izlenebilmeli.

## Veri güvenliği (zorunlu)

- Kullanıcıdan bir iş (madde) alındığında, koda/veriye dokunmadan ÖNCE `npm run backup` çalıştır; çıktıdaki "Yedek alındı" satırını doğrula. Yedek alınamazsa işe başlama, kullanıcıya söyle.
- Gerçek veri klasörüne (`%APPDATA%\Panel\data`) hiçbir zaman yazma; testleri `PANEL_PROFILE` + `--hidden` ile izole profilde yap, API anahtarı kopyalandıysa test profilini sil.
- Ayarlar (`settings.json`) ana süreçte her kayıtta `AppData\Panel\settings-yedek\son.json` ve `<yedek klasörü>\Panel yedekleri\ayarlar.json` olarak aynalanır; bozuk/sıfırlanmış dosya açılışta buradan geri yüklenir (`main.js` → Ayar güvenliği).

## 4. Hedef odaklı yürütme

- Görevi doğrulanabilir hedefe çevir: "hatayı düzelt" → "önce hatayı yeniden üret, sonra düzelt, sonra `npm run build` ve elle dene".
- Çok adımlı işlerde kısa plan yaz: `1. [adım] → doğrula: [kontrol]`.
- Kullanıcı verisine (todo, not, ayar, yedek) dokunan değişikliklerde geri dönüşü olmayan işlemden önce onay iste.

Bu ilkeler çalışıyorsa: diff'lerde gereksiz değişiklik azalır, aşırı karmaşıklıktan kaynaklı yeniden yazım azalır, açıklayıcı sorular hata yapıldıktan sonra değil, uygulamadan önce gelir.
