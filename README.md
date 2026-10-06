# Panel

Saat, tarih, hava durumu, yapılacaklar ve Markdown notlar için kişisel masaüstü paneli (Electron).

## Komutlar
- `npm start` — geliştirme modunda çalıştır (önce not editörünü `src/vendor` altına paketler)
  - Kurulu Panel açıkken test için: `PANEL_PROFILE=C:\bir\klasor npm start` (ayrı veri klasörü kullanır)
- `npm run dist` — `dist\Panel Setup 1.0.0.exe` kurulum dosyasını üret
- `npm run icon` — logoyu yeniden üret: `assets/icon.png`, çok boyutlu `assets/icon.ico` (görev çubuğu, pencere,
  tepsi, kurulum dosyası) ve `src/icons/logo.svg`. Logonun tasarımı `scripts/make-icon.js` içindedir; her yerde aynı kaynak kullanılır.

## Veriler
`%APPDATA%\Panel\data\` altında:
- `todo.md` — kategoriler `## Ad` başlıkları, görevler `- [ ] görev` / `- [x] görev` satırları.
  Dosyadaki sıra ekrandaki sıradır: her kategoride yapılmamışlar (yeniden eskiye), sonra yapılmışlar (en son tamamlanandan eskiye).
  Örnek satır: `- [ ] rapor yaz 🔁 her hafta 📅 2026-10-10 <!-- eklendi:2026-10-05T15:40 -->`
  (`🔁` tekrar kuralı, `📅` son tarih; yorum içindeki zamanlar arka planda tutulur ve Markdown'da görünmez)
  Tekrar kuralları: `her gün`, `hafta içi`, `her hafta`, `her 2 hafta`, `her ay`, `her yıl`, `her N gün/hafta/ay`.
- `notes\resimler\` — notlara yapıştırılan resimler. Notta `![resim|300](resimler/…)` olarak durur
  (`|300` genişliktir; Obsidian ile aynı biçim).
- Otomatik yedek: Ayarlar'da seçilen klasörde `Panel yedekleri\YYYY-AA-GG\` (son 7 gün).

## Görev ekleme
- Kategori başlığındaki **＋** kategorinin en üstünde, görev satırındaki **＋** o görevin hemen altında boş bir satır açar; doğrudan yazılır.
- **Enter**: ekler ve altına bir sonraki boş satırı açar (art arda hızlı giriş) · **Esc** ya da boş bırakıp başka yere tıklamak: vazgeçer.
- Yeni görev bugünün tarihini alır; satırdaki tarih düğmesinden (tarih + tekrar) değiştirilebilir.

## Görev yazarken tarih
Metnin başında ya da sonunda: `bugün`, `yarın`, `öbür gün`, `haftaya`, `hafta sonu`, `ay sonu`,
gün adları (`cuma`, `cumaya`…), `15 ekim`, `15.10`, `3 gün sonra`, `2 hafta sonra`; tekrar için `her gün`, `her hafta`…
- Silinen öğeler `<!-- silindi: … -->` işaretiyle dosyada kalır; Ayarlar → Silinenler'den geri getirilebilir.

## Kod yapısı
`src/js/` altında bölümler: `core` (ortak yardımcılar, tarih penceresi, doğal dil), `clock`, `weather`, `todos`,
`calendar`, `stats`, `notes`, `trash`, `layout`, `settings`; `src/app.js` başlangıç.
Sabah bildirimi ve otomatik yedek zamanlayıcısı `main.js` içindedir (dakikada bir kontrol eder).
- `notes\*.md` — her not ayrı bir Markdown dosyası
- `settings.json` — şehir, tema, otomatik başlatma, hava durumu önbelleği

## Kısayollar
- `Ctrl+Alt+P` — paneli aç/gizle (her yerden)
- `Ctrl+S` — notu hemen kaydet · not içindeki bağlantıyı açmak için `Ctrl+tık`
- Pencereyi kapatmak uygulamayı tepsiye gönderir; tamamen çıkmak için tepsi simgesi → **Çıkış**.

Hava durumu: [Open-Meteo](https://open-meteo.com) (API anahtarı gerekmez).
