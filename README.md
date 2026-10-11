# Panel

Saat, tarih, hava durumu, yapılacaklar, Markdown notlar ve sesli asistan SPARK için kişisel masaüstü paneli (Electron).

## Komutlar
- `npm start` — geliştirme modunda çalıştır (önce not editörünü `src/vendor` altına paketler)
  - Kurulu Panel açıkken test için: `PANEL_PROFILE=C:\bir\klasor npm start` (ayrı veri klasörü kullanır)
- `npm run dist` — `dist\Panel Setup <versiyon>.exe` kurulum dosyasını üret
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

## SPARK (sesli asistan)
Kendi kartında (küre + konuşma geçmişi) yaşar; kart gizliyse üst çubuğun altında küçük bir pencerede açılır.
Kartın ya da üst çubuğun mikrofon düğmesi veya `Ctrl+Alt+V` ile başlar; tekrar basmak kaydı durdurup gönderir.
Ses + o anki görev listesi tek bir Google Gemini isteğine gidiyor; hem konuşmayı anlama hem görev
listesine bakıp cevap verme Gemini'de oluyor, ayrı bir yerel konuşma tanımaya gerek yok.

- "Yarın rapor yaz ekle iş kategorisine" gibi bir cümle hem görevi hem tarihi hem kategoriyi anlar.
- Var olan görevleri de değiştirir: "süt almayı tamamla", "rapor görevini cumaya al", "eski işi sil" (silinenler Silinenler'den geri gelir).
- Bağlamında tarih/saat, hava durumu ve görev listesi var: "bugün hava nasıl?", "yarın şemsiye lazım mı?".
- **Otomatik gönderme:** konuşman bitince (ayarlanabilir sessizlik süresinden sonra) kayıt kendiliğinden gönderilir; Ayarlar → SPARK → Dinleme.
- Kategori söylenmezse SPARK sesle sorar, cevabını dinler.
- "16 Ekimde iş kategorisinde ne var?" gibi sorularda görev listesine bakıp cevap verir; belirli
  bir güne bağlıysa takvimde o günü otomatik açar.
- **Ses:** cevaplar Gemini TTS ile gerçekçi bir sesle okunur; ses tonu Ayarlar → SPARK'tan seçilir (▶ Dinle ile denenir).
  Ücretsiz ses kotası model başına günde ~10 cevaptır; birden çok TTS modeli virgülle yazılırsa sırayla denenir.
  Kota dolar ya da bağlantı olmazsa Windows'un yerel sesine (Tolga) düşülür — durum yazısında "yedek ses" görünür.
- **Animasyon:** küre, dinlerken mikrofondaki sesin, konuşurken SPARK'ın kendi sesinin gerçek seviyesine göre dalgalanır
  (yerel seste kelime vuruşlarıyla taklit edilir).
- **Kurulum:** Ayarlar → SPARK → [Google AI Studio](https://aistudio.google.com/app/apikey)'dan
  ücretsiz bir API anahtarı al (kredi kartı istemez), yapıştır. Model alanına Google AI Studio'daki model
  listesinden **"Flash Lite"** etiketli birinin tam kimliğini yapıştır — ücretsiz kullanımda günlük en
  yüksek istek hakkını bu veriyor. Anahtar ve modeller `settings.json`'da kalır, koda hiç girmez.
- Ses ve görev listesi metni yalnızca konuştuğun anda Google'a gider; konuşma geçmişi yalnızca bu bilgisayarda tutulur (son 30).

## Kod yapısı
`src/js/` altında bölümler: `core` (ortak yardımcılar, tarih penceresi, doğal dil), `clock`, `weather`, `todos`,
`calendar`, `assistant` (SPARK), `stats`, `notes`, `trash`, `layout`, `settings`; `src/app.js` başlangıç.
Sabah bildirimi, otomatik yedek ve Gemini API çağrısı `main.js` içindedir (zamanlayıcı dakikada bir kontrol eder).
- `notes\*.md` — her not ayrı bir Markdown dosyası
- `settings.json` — şehir, tema, otomatik başlatma, hava durumu önbelleği

## Kısayollar
- `Ctrl+Alt+P` — paneli aç/gizle (her yerden)
- `Ctrl+Alt+V` — SPARK'ı dinlet/durdur (her yerden)
- `Ctrl+S` — notu hemen kaydet · not içindeki bağlantıyı açmak için `Ctrl+tık`
- Pencereyi kapatmak uygulamayı tepsiye gönderir; tamamen çıkmak için tepsi simgesi → **Çıkış**.

Hava durumu: [Open-Meteo](https://open-meteo.com) (API anahtarı gerekmez).
