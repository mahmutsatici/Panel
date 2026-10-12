// ============ SPARK (sesli asistan) ============
// Mikrofon düğmesi / SPARK kartındaki düğme / Ctrl+Alt+V ile kayıt başlar; tekrar basınca durur ve
// kayıt Gemini API'ye (ses + o anki görev listesi) gönderilir. Gemini hem sesi anlıyor hem görev
// listesine bakıp cevap veriyor — ayrı bir yerel konuşma tanımaya gerek yok.
//
// Cevabın sesi: önce Gemini TTS (gerçekçi, seçilebilir ses tonları). Kota dolarsa ya da bağlantı
// yoksa otomatik olarak Windows'un yerel sesine (Tolga) düşülür; SPARK hiçbir durumda susmaz.
//
// Akış: kayıt → WAV'a çevir → api.assistant.ask(ses, bağlam) → Gemini JSON döner:
//   add_task       → görev eklenir, sesli onaylanır
//   need_category  → sesli sorulur, mikrofon tekrar açılıp kategori cevabı beklenir
//   answer         → sesli + yazılı cevaplanır; belirli bir güne bağlıysa takvimde o gün açılır
//
// Görünüm: SPARK kartı yerleşimde görünürken her şey kartta olur (küre + konuşma geçmişi).
// Kart gizliyse aynı etkileşim üst çubuğun altında açılan küçük pencerede gösterilir.

// Gemini'nin hazır sesleri (Ayarlar → SPARK → Ses tonu). Açıklamalar Google'ın ses tarifleridir.
const SPARK_VOICES = [
  ['Kore', 'Kararlı'], ['Zephyr', 'Parlak'], ['Puck', 'Neşeli'], ['Charon', 'Bilgilendirici'],
  ['Fenrir', 'Heyecanlı'], ['Leda', 'Genç'], ['Orus', 'Kararlı'], ['Aoede', 'Ferah'],
  ['Callirrhoe', 'Rahat'], ['Autonoe', 'Parlak'], ['Enceladus', 'Nefesli'], ['Iapetus', 'Net'],
  ['Umbriel', 'Rahat'], ['Algieba', 'Yumuşak'], ['Despina', 'Yumuşak'], ['Erinome', 'Net'],
  ['Algenib', 'Boğuk'], ['Rasalgethi', 'Bilgilendirici'], ['Laomedeia', 'Neşeli'], ['Achernar', 'Yumuşak'],
  ['Alnilam', 'Sert'], ['Schedar', 'Dengeli'], ['Gacrux', 'Olgun'], ['Pulcherrima', 'Atılgan'],
  ['Achird', 'Samimi'], ['Zubenelgenubi', 'Gündelik'], ['Vindemiatrix', 'Nazik'], ['Sadachbia', 'Canlı'],
  ['Sadaltager', 'Bilgili'], ['Sulafat', 'Sıcak'],
];

let asState = 'idle';   // idle | listening | thinking | speaking | added | asking | answer | error
let mediaStream = null, mediaRecorder = null, audioChunks = [];
let voicePrep = false;  // cevabın sesi hazırlanıyor (yazı ekranda; kullanıcı araya girebilir)
let pending = null;     // need_category sorusundan sonra bir sonraki kayda eklenecek bağlam notu
let autoCloseTimer = null;
let recordTimeout = null;
let sparkLog = store.get('sparkLog', []);   // konuşma geçmişi (son 30 konuşma, bu bilgisayarda)

const asPop = $('#assistantPop');
const sparkCardVisible = () => !!document.querySelector('.card[data-card="spark"]')?.offsetParent;

// ============ Küre animasyonu ============
// Birkaç yarı saydam "dalga" katmanı üst üste çizilir; boyutu ve dalgalanması anlık ses seviyesine
// göre değişir. Ses seviyesi dinlerken mikrofondan, konuşurken SPARK'ın kendi sesinden gerçek zamanlı
// ölçülür (AnalyserNode). Windows sesine düşüldüğünde ses verisine erişilemediği için seviye,
// konuşulan her kelimede (boundary olayı) kısa bir vuruşla taklit edilir.
const orb = { level: 0, target: 0, t: 0, analyser: null, buf: null, fakeUntil: 0 };
const hexRgb = hex => {
  const m = hex.trim().replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  return m ? m.slice(1).map(h => parseInt(h, 16)) : [123, 147, 255];
};
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
function orbPalette() {
  const css = getComputedStyle(document.documentElement);
  const accent = hexRgb(css.getPropertyValue('--accent')), danger = hexRgb(css.getPropertyValue('--danger'));
  if (asState === 'listening') return [danger, [255, 140, 170], [255, 190, 120]];
  if (asState === 'error') return [danger, danger, [140, 140, 150]];
  return [accent, [139, 92, 246], [56, 189, 248]];
}
function drawOrb(cv, pal) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, L = orb.level, t = orb.t;
  const thinking = asState === 'thinking';
  const breathe = asState === 'idle' || asState === 'added' || asState === 'answer' ? Math.sin(t * 1.3) * 0.04 : 0;
  const R = Math.min(w, h) * 0.3 * (1 + breathe + L * 0.32);

  // Dış ışıma
  // Işıma tuvalin kenarından önce sönmeli; yoksa kenarda kesik bir çizgi görünür
  const glow = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, Math.min(R * 1.9, Math.min(w, h) / 2));
  glow.addColorStop(0, rgba(pal[0], 0.28 + L * 0.3));
  glow.addColorStop(1, rgba(pal[0], 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Dalgalanan katmanlar (üst üste toplanarak parlayan bir küre oluşturur)
  ctx.globalCompositeOperation = 'lighter';
  const amp = 0.04 + L * 0.22 + (thinking ? 0.07 : 0);
  const speed = thinking ? 2.6 : 1 + L * 2;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const wob = Math.sin(3 * a + t * speed * (1 + k * 0.35) + k * 2.1) * 0.5
        + Math.sin(5 * a - t * speed * 0.8 + k * 1.3) * 0.3
        + Math.sin(2 * a + t * speed * 0.5 + k) * 0.2;
      const r = R * (0.86 + amp * wob);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.05);
    g.addColorStop(0, rgba([255, 255, 255], 0.5));
    g.addColorStop(0.35, rgba(pal[k], 0.55));
    g.addColorStop(1, rgba(pal[k], 0.08));
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
let lastFrame = 0;
function orbLoop(ts) {
  const dt = Math.min(0.05, (ts - lastFrame) / 1000 || 0);
  lastFrame = ts;
  orb.t += dt;
  // Ses seviyesi: gerçek ses varsa ondan, yoksa (Windows sesi) kelime vuruşlarından
  if (orb.analyser) {
    orb.analyser.getByteTimeDomainData(orb.buf);
    let sum = 0;
    for (let i = 0; i < orb.buf.length; i++) { const v = (orb.buf[i] - 128) / 128; sum += v * v; }
    orb.target = Math.min(1, Math.sqrt(sum / orb.buf.length) * 4.5);
  } else if (performance.now() < orb.fakeUntil) {
    orb.target = Math.max(orb.target * 0.9, 0.15);
  } else {
    orb.target *= 0.9;
  }
  // Yükselirken hızlı, düşerken yumuşak (konuşma gibi görünsün diye)
  orb.level += (orb.target - orb.level) * (orb.target > orb.level ? 0.45 : 0.12);
  const pal = orbPalette();
  $$('.spark-orb').forEach(cv => { if (cv.offsetParent) drawOrb(cv, pal); });
  requestAnimationFrame(orbLoop);
}
requestAnimationFrame(orbLoop);

// ============ Konuşma (ses çıkışı) ============
let playCtx = null, playSource = null, speakToken = 0;
function stopSpeaking() {
  speakToken++;   // henüz hazırlanmakta olan bir ses varsa çalınmasın
  try { playSource?.stop(); } catch {}
  playSource = null;
  orb.analyser = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
// Gemini'den gelen ham PCM'i (16 bit, tek kanal) çalar; çalarken küre sesin gerçek seviyesini izler.
function playPcm(bytes, rate) {
  playCtx ||= new AudioContext();
  const copy = new Uint8Array(bytes);   // hizalı yeni bir tampon (Int16Array için)
  const samples = new Int16Array(copy.buffer, 0, copy.length >> 1);
  const buf = playCtx.createBuffer(1, samples.length, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
  const src = playCtx.createBufferSource();
  src.buffer = buf;
  const an = playCtx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  an.connect(playCtx.destination);
  orb.analyser = an;
  orb.buf = new Uint8Array(an.fftSize);
  playSource = src;
  return new Promise(resolve => {
    src.onended = () => { if (playSource === src) { playSource = null; orb.analyser = null; } resolve(); };
    playCtx.resume().then(() => src.start());
  });
}
// Yedek: Windows'un yerel sesi. Ses verisine erişilemediği için küre her kelimede kısa bir vuruş yapar.
function speakLocal(text) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'tr-TR';
    const trVoice = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('tr'));
    if (trVoice) u.voice = trVoice;
    u.onboundary = () => { orb.target = 0.55 + Math.random() * 0.35; orb.fakeUntil = performance.now() + 180; };
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}
// Metni sesli söyler, konuşma bitince döner. need_category akışında mikrofonu SPARK'ın sözü bitmeden
// açmamak, kendi sesinin mikrofona karışmasını (ve Gemini'yi yanıltmasını) önler.
// Döndürdüğü değer hangi sesin kullanıldığıdır: 'gemini' ya da 'yerel'.
// onStart: ses gerçekten çalmaya başlarken çağrılır (Gemini sesi hazırlanırken birkaç saniye geçebilir).
async function speak(text, voice, onStart) {
  if (!text) return null;
  stopSpeaking();
  const token = speakToken;
  if (settings.ttsEnabled !== false && settings.geminiApiKey) {
    try {
      const { pcm, sampleRate } = await api.assistant.speak(text, voice);
      if (token !== speakToken) return null;   // hazırlanırken kapatıldı / yeni kayda geçildi
      onStart?.();
      await playPcm(pcm, sampleRate);
      return 'gemini';
    } catch (err) {
      if (token !== speakToken) return null;
      console.warn('SPARK: Gemini sesi kullanılamadı, Windows sesine dönülüyor —', cleanErr(err));
    }
  }
  onStart?.();
  await speakLocal(text);
  return 'yerel';
}

// ============ Görev listesi bağlamı ============
// Gemini'ye giden bağlam: tarih/saat, hava durumu ve kimlikli görev listesi. Görevlerin başındaki
// [t3] gibi kimlikler, Gemini'nin "şu görevi tamamla" derken hangisini kastettiğini bildirmesi içindir.
let ctxTasks = new Map();   // kimlik → { cat, task } (yalnızca o anki istek için geçerli)
const WEATHER_DESC = c => wmo(c, true)[1];
function weatherContext() {
  const city = settings.city, w = settings.weatherCache;
  if (!city) return 'Hava durumu: şehir seçilmemiş.';
  if (!w || w.lat !== city.lat || w.lon !== city.lon) return `Hava durumu: ${city.name} için veri henüz alınmadı.`;
  const c = w.data.current, d = w.data.daily, r = Math.round;
  const lines = [`Hava durumu (${city.name}, güncelleme ${fmtTime.format(new Date(w.at))}):`,
    `- Şu an: ${WEATHER_DESC(c.weather_code)}, ${r(c.temperature_2m)}°C (hissedilen ${r(c.apparent_temperature)}°C), nem %${c.relative_humidity_2m}, rüzgar ${r(c.wind_speed_10m)} km/s`];
  d.time.forEach((t, i) => {
    const name = i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : fmtWeekday.format(new Date(t + 'T12:00'));
    const rain = d.precipitation_probability_max?.[i];
    lines.push(`- ${name} (${t}): ${WEATHER_DESC(d.weather_code[i])}, en düşük ${r(d.temperature_2m_min[i])}°C, en yüksek ${r(d.temperature_2m_max[i])}°C${rain != null ? `, yağış ihtimali %${rain}` : ''}`);
  });
  return lines.join('\n');
}
function tasksContext(typedText) {
  const now = new Date(), today = todayISO();
  const lines = [`Şu an: ${today} (${fmtLongDay.format(parseISODate(today))}) saat ${fmtTime.format(now)}`, '', weatherContext(), '', 'Görev listesi:'];
  const lists = (settings.musicLists || []).map(l => l.name);
  lines.push(lists.length
    ? `Müzik listelerim (play_music için music_list alanına AYNEN bu adlardan birini yaz):\n${lists.map(n => `- ${n}`).join('\n')}`
    : 'Müzik listelerim: tanımlı değil.', '');
  ctxTasks = new Map();
  let n = 0;
  for (const cat of activeCats()) {
    lines.push(`## ${cat.name}`);
    for (const t of cat.tasks) {
      const id = `t${++n}`;
      ctxTasks.set(id, { cat, task: t });
      lines.push(`[${id}] ${taskLine(t)}`);
    }
  }
  // Aynı sohbetten devam: son birkaç konuşma Gemini'ye de gider
  const recent = sparkLog.filter(e => e.answer && e.kind !== 'error').slice(-6);
  if (recent.length) {
    lines.push('', 'Önceki konuşma (eskiden yeniye):');
    for (const e of recent) {
      if (e.heard) lines.push(`Kullanıcı: ${e.heard}`);
      lines.push(`SPARK: ${e.answer}`);
    }
  }
  if (pending?.length) {
    lines.push('', 'Önceki istek: kullanıcı şu görevleri eklemek istiyor:');
    for (const p of pending) lines.push(`- "${p.task_text}" (tarih: ${p.due || 'yok'}, tekrar: ${p.rec || 'yok'})`);
    lines.push('Şimdi söylediği/yazdığı sadece kategori adı olacak; buna göre type "actions" ile hepsini add_task olarak o kategoriye ekle.');
  }
  if (typedText) lines.push('', `Kullanıcının YAZDIĞI mesaj (ses yok): ${typedText}`);
  return lines.join('\n');
}

// Gemini'nin verdiği kategori adını mevcut kategorilerle eşleştirir; yoksa yeni kategori açar.
function resolveCategory(name) {
  const clean = (name || '').trim();
  if (!clean) return currentCat();
  const existing = activeCats().find(c => lower(c.name) === lower(clean));
  if (existing) return existing;
  todo.cats.push(newCat(clean));
  return activeCats().find(c => c.name === clean);
}

// ============ Ses kaydı ============
let micCtx = null;
async function startRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  mediaRecorder = new MediaRecorder(mediaStream);
  mediaRecorder.ondataavailable = e => { if (e.data.size) audioChunks.push(e.data); };
  mediaRecorder.start();
  // Dinlerken küre mikrofondaki sesin seviyesine tepki versin
  micCtx = new AudioContext();
  const an = micCtx.createAnalyser();
  an.fftSize = 1024;
  micCtx.createMediaStreamSource(mediaStream).connect(an);
  orb.analyser = an;
  orb.buf = new Uint8Array(an.fftSize);
  startSilenceWatch(an);
  // Unutulursa sonsuza kadar dinlemesin / kotayı boşuna harcamasın
  recordTimeout = setTimeout(() => { if (asState === 'listening') stopAndSend(); }, 20000);
}
// Sessizlik algılama: konuşma başladıktan sonra ayardaki süre kadar sessizlik olursa kayıt kendiliğinden
// gönderilir; hiç konuşulmazsa 8 saniye sonra vazgeçilir (boş sesle kota harcanmasın).
// Eşik, kaydın ilk yarım saniyesindeki ortam gürültüsüne göre ayarlanır.
let silenceTimer = null;
function startSilenceWatch(an) {
  const quietMs = Number(settings.sparkSilenceMs ?? 1500);
  if (!quietMs) return;
  const buf = new Uint8Array(an.fftSize);
  const t0 = performance.now();
  let noise = 0, spoke = false, lastLoud = t0, loudMs = 0, prev = t0;
  silenceTimer = setInterval(() => {
    const now = performance.now(), dt = now - prev;
    prev = now;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / buf.length);
    if (now - t0 < 500) { noise = Math.max(noise, rms); return; }
    const loud = rms > Math.max(0.02, noise * 2.5);
    if (loud) { lastLoud = now; loudMs += dt; if (loudMs > 150) spoke = true; }
    if (spoke && now - lastLoud > quietMs) { stopSilenceWatch(); stopAndSend(); }
    else if (!spoke && now - t0 > 8000) { stopSilenceWatch(); cancelListening('Ses duymadım.'); }
  }, 60);
}
function stopSilenceWatch() { clearInterval(silenceTimer); silenceTimer = null; }
// Dinleme boşa çıktı: hiçbir şey gönderilmez, panel kapanır
function cancelListening(msg) {
  clearTimeout(recordTimeout);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') { mediaRecorder.onstop = null; mediaRecorder.stop(); }
  releaseMic();
  showExchange('', msg);
  setState('idle');
  autoCloseTimer = setTimeout(() => { if (asState === 'idle' && !sparkCardVisible()) closeAssistant(); }, 2500);
}
function releaseMic() {
  stopSilenceWatch();
  orb.analyser = null;
  micCtx?.close();
  micCtx = null;
  mediaStream?.getTracks().forEach(t => t.stop());
}
function stopRecordingRaw() {
  return new Promise(resolve => {
    mediaRecorder.onstop = () => {
      releaseMic();
      resolve(new Blob(audioChunks, { type: mediaRecorder.mimeType }));
    };
    mediaRecorder.stop();
  });
}

// Kaydedilen sesi (webm/opus) tek kanallı 16 bit PCM WAV'a çevirir — Gemini'nin her sürümde
// güvenilir kabul ettiği biçim budur, tarayıcının kendi kayıt biçimine bağımlı kalmayalım diye.
async function blobToWav(blob) {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close();
  // 16 kHz tek kanala indir: konuşma tanıma için yeterli, yükleme birkaç kat küçük (yanıt daha hızlı gelir)
  const RATE = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const data = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, data.length * 2, true);
  let o = 44;
  for (let i = 0; i < data.length; i++, o += 2) {
    const v = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

// ============ Görünüm: durum, küçük pencere, konuşma geçmişi ============
const STATE_LABELS = {
  idle: 'hazır', listening: 'dinliyor…', thinking: 'düşünüyor…', speaking: 'konuşuyor…',
  added: 'eklendi ✓', done: 'tamam ✓', asking: 'soruyor', answer: 'cevap verdi', error: 'bir sorun oluştu',
};
const listeningLabel = () => (Number(settings.sparkSilenceMs ?? 1500) ? 'dinliyor… (sustuğunda gönderilir)' : 'dinliyor… (bitirmek için tekrar bas)');
function setState(state, label) {
  clearTimeout(autoCloseTimer);
  asState = state;
  const text = label || STATE_LABELS[state] || '';
  $$('.spark-state').forEach(el => { el.textContent = text; el.dataset.state = state; });
  for (const b of [$('#micBtn'), $('#sparkMic')]) {
    b.classList.toggle('listening', state === 'listening');
    b.classList.toggle('busy', state === 'thinking' || state === 'speaking');
  }
  // Kart görünmüyorsa etkileşimi küçük pencerede göster
  if (state !== 'idle' && !sparkCardVisible()) asPop.hidden = false;
}
function showExchange(heard, answer) {
  $('#asHeard').textContent = heard ? `"${heard}"` : '';
  $('#asAnswer').textContent = answer || '';
}
const fmtLogTime = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
function renderLog() {
  const ul = $('#sparkLog');
  if (!sparkLog.length) {
    ul.innerHTML = '<li class="spark-empty">Mikrofona basıp konuş: "yarın rapor yaz ekle iş kategorisine" ya da "bugün neler var?"</li>';
    return;
  }
  ul.innerHTML = sparkLog.map(e => `
    ${e.heard ? `<li class="msg me"><span>${esc(e.heard)}</span></li>` : ''}
    ${e.answer ? `<li class="msg spark ${e.kind}"><span>${esc(e.answer)}</span><time>${fmtLogTime.format(new Date(e.at))}</time></li>` : ''}`).join('');
  ul.scrollTop = ul.scrollHeight;
}
let tempEntry = null;   // yazılı mesaj gönderildi, cevap bekleniyor (balon hemen görünsün)
function addLog(heard, answer, kind) {
  if (tempEntry) { sparkLog = sparkLog.filter(e => e !== tempEntry); tempEntry = null; }
  sparkLog.push({ at: Date.now(), heard: heard || '', answer: answer || '', kind });
  sparkLog = sparkLog.slice(-30);
  store.set('sparkLog', sparkLog);
  renderLog();
}
function closeAssistant() {
  clearTimeout(autoCloseTimer);
  clearTimeout(recordTimeout);
  asPop.hidden = true;
  pending = null;
  stopSpeaking();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') { mediaRecorder.onstop = null; mediaRecorder.stop(); }
  releaseMic();
  setState('idle');
}
// Sonuç gösterilirken dışarı tıklamak küçük pencereyi kapatır; kayıt/düşünme/konuşma sürerken kesmez
document.addEventListener('mousedown', e => {
  if (asPop.hidden || ['listening', 'thinking', 'speaking'].includes(asState)) return;
  if (!e.target.closest('#assistantPop, #micBtn, #sparkMic')) closeAssistant();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && asState !== 'idle') closeAssistant(); });
$('#asClose').onclick = closeAssistant;
$('#sparkClear').onclick = () => { sparkLog = []; store.set('sparkLog', sparkLog); renderLog(); };

// ============ Ana akış ============
async function toggleListening() {
  if (asState === 'listening') return stopAndSend();
  if (asState === 'thinking' && !voicePrep) return;   // cevap beklenirken yeni kayda başlama (ses hazırlanırken serbest)
  stopSpeaking();                         // SPARK konuşurken basılırsa sözünü kesip dinlemeye geç
  try {
    await startRecording();
    showExchange('', '');
    setState('listening', listeningLabel());
    loadWeather().catch(() => {});   // süresi dolmuşsa konuşurken tazelenir; soru sorulunca bağlamda güncel olsun
  } catch {
    showExchange('', 'Mikrofona erişilemedi. Windows ayarlarından Panel\'e mikrofon izni verildiğinden emin ol.');
    setState('error');
  }
}
let typedMode = false;   // true: yazılı sohbet — cevap sesli okunmaz
async function sendTyped(text) {
  text = text.trim();
  if (!text) return;
  if (asState === 'thinking' && !voicePrep) return;   // bir cevap beklenirken yenisi gönderilmez
  if (asState === 'listening') cancelListening('');
  stopSpeaking();
  typedMode = true;
  tempEntry = { at: Date.now(), heard: text, answer: '', kind: 'wait' };
  sparkLog.push(tempEntry);
  renderLog();
  setState('thinking');
  try {
    const res = await api.assistant.ask(null, null, tasksContext(text));
    res.heard = text;
    await handleResponse(res);
  } catch (err) {
    const msg = cleanErr(err);
    showExchange(text, msg);
    addLog(text, msg, 'error');
    setState('error');
    autoCloseTimer = setTimeout(() => setState('idle'), 4000);
  }
}
async function stopAndSend() {
  typedMode = false;
  clearTimeout(recordTimeout);
  setState('thinking');
  const blob = await stopRecordingRaw();
  try {
    const wav = await blobToWav(blob);
    const res = await api.assistant.ask(wav, 'audio/wav', tasksContext());
    await handleResponse(res);
  } catch (err) {
    const msg = cleanErr(err);
    showExchange('', msg);
    addLog('', msg, 'error');
    setState('error');
    await speakLocal(`Bir sorun oluştu. ${msg}`);
    autoCloseTimer = setTimeout(closeAssistant, 5000);
  }
}

// Gemini'nin görevler üzerinde yapabildiği işlemler (todos.js'teki aynı fonksiyonlar kullanılır,
// böylece elle yapılan işlemle birebir aynı sonucu verir: tekrarlayan görev, silinenler işareti vb.)
const TASK_ACTIONS = new Set(['complete_task', 'reopen_task', 'delete_task', 'update_task']);
const SYSTEM_ACTIONS = new Set(['open_url', 'play_music', 'media_control']);
const LEGACY_TYPES = new Set(['add_task', ...TASK_ACTIONS]);
// Eski tek-işlem biçimi gelirse (type: "add_task" vb.) actions dizisine çevir
function actionsOf(res) {
  if (Array.isArray(res.actions) && res.actions.length) return res.actions;
  if (LEGACY_TYPES.has(res.type)) return [{ action: res.type, ...res }];
  return [];
}
async function applyTaskAction(a) {
  const target = ctxTasks.get(a.task_id);
  // Görev bu arada silinmiş/değişmişse (ya da kimlik hatalıysa) dokunma
  if (!target || !target.cat.tasks.includes(target.task)) return false;
  const { cat, task } = target;
  if (a.action === 'complete_task') await setDone(cat, task, true);
  else if (a.action === 'reopen_task') await setDone(cat, task, false);
  else if (a.action === 'delete_task') { deleteTask(cat, task); await saveTodos(); }
  else {
    // update_task: yalnızca Gemini'nin doldurduğu alanlar değişir; "yok" ilgili alanı kaldırır
    if (a.new_text?.trim()) task.text = a.new_text.trim();
    if (a.due) task.due = /^yok$/i.test(a.due) ? undefined : a.due;
    if (a.rec) task.rec = /^yok$/i.test(a.rec) ? undefined : a.rec;
    await saveTodos();
  }
  return true;
}

async function handleResponse(res) {
  if (asState !== 'thinking') return;   // kullanıcı bu arada kapattıysa sonucu uygulama
  showExchange(res.heard, res.speech);
  let acts = actionsOf(res);
  const isNew = a => a.action === 'add_task' && a.task_text;

  // Kategori sorusuna cevap: model görevleri taşımayı unutursa (küçük modeller bazen unutuyor) söylenen
  // kategori adından bekleyen görevler yerel olarak tamamlanır.
  if (pending?.length) {
    const heard = lower(res.heard || '');
    const hit = activeCats().filter(c => heard.includes(lower(c.name)));
    if (hit.length === 1) {
      const adds = acts.filter(isNew);
      if (adds.length) adds.forEach(a => { if (!a.category?.trim()) a.category = hit[0].name; });
      else {
        acts = [...acts, ...pending.map(p => ({ ...p, category: hit[0].name }))];
        res.speech = `${pending.length} görevi ${hit[0].name} kategorisine ekledim.`;
        showExchange(res.heard, res.speech);
      }
    }
  }

  // Kategorisi söylenmemiş yeni görevler: birden fazla kategori varsa model karar vermiş olsa bile sorulur
  // (tahminle yanlış kategoriye görev eklemek, sormaktan daha kötü). Tek kategori varsa ona eklenir.
  const multiCat = activeCats().length > 1;
  // Model kategoriyi tahminle de doldurabilir; kullanıcı (bu ya da son mesajlarda) o kategoriyi anmadıysa
  // "söylenmemiş" sayılır ve sorulur. Eşleşme: kategori adının tamamı ya da 3+ harfli herhangi bir sözcüğü.
  const said = lower([...sparkLog.slice(-4).map(e => e.heard), res.heard || ''].join(' '));
  const mentioned = name => {
    const n = lower(name || '').trim();
    return !!n && (said.includes(n) || n.split(/\s+/).some(w => w.length >= 3 && said.includes(w)));
  };
  const hasCat = a => !!a.category?.trim() && mentioned(a.category);
  const missing = multiCat ? acts.filter(a => isNew(a) && !hasCat(a)) : [];
  const ready = acts.filter(a => !missing.includes(a));

  pending = null;
  let finalState = 'answer', speech = res.speech, added = 0, changed = 0, failed = 0, lastCat = null, sys = 0, sysErr = '';
  for (const a of ready) {
    if (isNew(a)) {
      const cat = resolveCategory(a.category);
      lastCat = cat;
      await addTask(cat, a.task_text, a.due || null, a.rec || null);
      added++;
    } else if (TASK_ACTIONS.has(a.action)) {
      if (await applyTaskAction(a)) changed++; else failed++;
    } else if (SYSTEM_ACTIONS.has(a.action)) {
      // Tarayıcıda sayfa aç / YouTube Music çal / medya tuşu (ana süreç yapar)
      const call = api.assistant.system({ type: a.action, url: a.url, query: a.music_query, kind: a.music_kind, list: a.music_list, key: a.media_key })
        .catch(e => ({ ok: false, message: cleanErr(e) }));
      if (a.action === 'play_music') {
        // Müziğin açılması 10-20 sn sürebilir; SPARK cevabını beklemeden verir, hata olursa sohbete düşer
        sys++;
        call.then(r => { if (!r.ok) { const msg = r.message || 'Müziği açamadım.'; showExchange(res.heard, msg); addLog('', msg, 'error'); } });
      } else {
        const r = await call;
        if (r.ok) sys++; else sysErr = r.message || 'Bu işlemi yapamadım.';
      }
    }
  }
  if (lastCat) selectCat(lastCat.name);

  if (missing.length || res.type === 'need_category') {
    // Kategori sorulacak; bekleyen görevler bir sonraki mesaja bağlam olarak taşınır
    pending = missing.length ? missing : null;
    if (missing.length) {
      const done = added + changed ? `${added + changed} işlem tamam. ` : '';
      speech = `${done}${missing.length > 1 ? 'Bu görevleri' : 'Bu görevi'} hangi kategoriye ekleyeyim?`;
    }
    showExchange(res.heard, speech);
    addLog(res.heard, speech, 'asking');
    setState('thinking');
    const voice = await sayAndShow(speech, 'asking');
    // Soru sesli sorulduysa mikrofon otomatik açılır (kullanıcı araya girip kapatmadıysa)
    if (asState === 'asking' && voice !== null && voice !== 'sessiz') toggleListening();
    return;
  }

  if (added) finalState = 'added';
  else if (changed || sys) finalState = 'done';
  else if (sysErr) { speech = sysErr; finalState = 'error'; }
  else if (failed) speech = 'Hangi görevi kastettiğinden emin olamadım, tekrar söyler misin?';
  else if (res.highlight_date) openCalDay(res.highlight_date);
  if (failed && (added || changed)) speech += ' Bir kısmını bulamadım.';
  if (speech !== res.speech) showExchange(res.heard, speech);
  addLog(res.heard, speech, finalState);
  await sayAndShow(speech, finalState);
  if (asState === finalState) autoCloseTimer = setTimeout(() => { if (!sparkCardVisible()) closeAssistant(); else setState('idle'); }, 4000);
}
// Cevabı seslendir; konuşurken durum "konuşuyor", bitince verilen son durum. Windows sesine
// düşüldüyse bunu durum yazısında belirt (kota dolduğunu kullanıcı anlasın).
async function sayAndShow(text, endState) {
  if (typedMode) { setState(endState); return 'sessiz'; }   // yazılı sohbet: sessiz cevap
  // Gemini sesi birkaç saniyede hazırlanır; yazı ekranda zaten görünüyor, durum bunu belirtsin
  setState('thinking', 'ses hazırlanıyor…');
  voicePrep = true;
  const used = await speak(text, undefined, () => { voicePrep = false; setState('speaking'); });
  voicePrep = false;
  if (asState !== 'speaking') return null;   // bu arada kapatıldı / sözü kesildi
  setState(endState, used === 'yerel' && settings.ttsEnabled !== false && settings.geminiApiKey
    ? `${STATE_LABELS[endState]} · yedek ses` : undefined);
  return used;
}

// Ayarlar → SPARK → "Dinle": seçili ses tonuyla örnek cümle (kota kullanır)
async function previewVoice(voice) {
  setState('speaking');
  await speak('Merhaba, ben SPARK. Bugün neler yapmak istersin?', voice);
  setState('idle');
}

for (const b of [$('#micBtn'), $('#sparkMic')]) b.onclick = toggleListening;
$('#sparkForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#sparkText');
  const text = input.value;
  input.value = '';
  sendTyped(text);
});
api.assistant.onTrigger(toggleListening);
document.addEventListener('keydown', e => {
  // Ctrl+Alt+V global kısayolun yanında, pencere odaktayken de çalışsın
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'v') { e.preventDefault(); toggleListening(); }
});
renderLog();
setState('idle');
