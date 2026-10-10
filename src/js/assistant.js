// ============ Sesli asistan ============
// Mikrofon düğmesi / Ctrl+Alt+V ile kayıt başlar; durdurunca kayıt Gemini API'ye (ses + o anki
// görev listesi) gönderilir. Gemini hem sesi anlıyor hem görev listesine bakıp cevap veriyor —
// ayrı bir yerel konuşma tanımaya gerek yok. Cevabı sesli okumak (TTS) tamamen yerelde/bedava:
// Windows'un kendi speechSynthesis'i kullanılır, hiçbir ses dışarı gönderilmez.
//
// Akış: kayıt → WAV'a çevir → api.assistant.ask(ses, bağlam) → Gemini JSON döner:
//   add_task       → görev eklenir, sesli onaylanır
//   need_category  → sesli sorulur, mikrofon tekrar açılıp kategori cevabı beklenir
//   answer         → sesli + yazılı cevaplanır; belirli bir güne bağlıysa takvimde o gün açılır
let asState = 'idle';   // idle | listening | thinking
let mediaStream = null, mediaRecorder = null, audioChunks = [];
let pending = null;     // need_category sorusundan sonra bir sonraki kayda eklenecek bağlam notu
let autoCloseTimer = null;
let recordTimeout = null;

const asPop = $('#assistantPop');

// --- Metni sesli oku (yerelde/bedava), konuşma bitince dönen bir söz verir.
// need_category akışında mikrofonu kendi sesimiz bitmeden açmamak, kendi sesimizin mikrofona
// karışmasını (ve Gemini'yi yanıltmasını) önlüyor.
function speak(text) {
  return new Promise(resolve => {
    if (!text || !('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'tr-TR';
    const trVoice = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('tr'));
    if (trVoice) u.voice = trVoice;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

// --- O anki görev listesini Gemini'nin okuyacağı düz metne çevir (mevcut taskLine'ı kullanır) ---
function tasksContext() {
  const today = todayISO();
  const lines = [`Bugünün tarihi: ${today} (${fmtLongDay.format(parseISODate(today))})`, '', 'Görev listesi:'];
  for (const cat of activeCats()) {
    lines.push(`## ${cat.name}`);
    for (const t of cat.tasks) lines.push(taskLine(t));
  }
  if (pending) {
    lines.push('', `Önceki istek: kullanıcı "${pending.text}" görevini eklemek istiyor` +
      ` (tarih: ${pending.due || 'yok'}, tekrar: ${pending.rec || 'yok'}).` +
      ' Şimdi söylediği sadece kategori adı olacak; buna göre type "add_task" ile tamamla.');
  }
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

// --- Kayıt: MediaRecorder ile al, Gemini'nin güvenilir kabul ettiği WAV'a çevir ---
async function startRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  mediaRecorder = new MediaRecorder(mediaStream);
  mediaRecorder.ondataavailable = e => { if (e.data.size) audioChunks.push(e.data); };
  mediaRecorder.start();
  // Unutulursa sonsuza kadar dinlemesin / kotayı boşuna harcamasın
  recordTimeout = setTimeout(() => { if (asState === 'listening') stopAndSend(); }, 20000);
}
function stopRecordingRaw() {
  return new Promise(resolve => {
    mediaRecorder.onstop = () => {
      mediaStream.getTracks().forEach(t => t.stop());
      resolve(new Blob(audioChunks, { type: mediaRecorder.mimeType }));
    };
    mediaRecorder.stop();
  });
}

// Kaydedilen sesi (webm/opus) tek kanallı 16 bit PCM WAV'a çevirir — Gemini'nin her sürümde
// güvenilir kabul ettiği biçim budur, tarayıcının kendi kayıt biçimine bağımlı kalmayalım diye.
async function blobToWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const rate = audioBuffer.sampleRate;
  let data = audioBuffer.getChannelData(0);
  if (audioBuffer.numberOfChannels > 1) {
    const ch1 = audioBuffer.getChannelData(1), mono = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) mono[i] = (data[i] + ch1[i]) / 2;
    data = mono;
  }
  const buf = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, data.length * 2, true);
  let off = 44;
  for (let i = 0; i < data.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  ctx.close();
  return new Uint8Array(buf);
}

// --- Panel: durum göstergesi ---
const STATE_LABELS = {
  listening: '🎙️ Dinliyor… (bitirmek için tekrar tıkla)', thinking: 'Düşünüyor…',
  added: 'Eklendi ✓', asking: 'Soru', answer: 'Cevap', error: '⚠ Sorun oluştu',
};
function showPanel(state, label) {
  clearTimeout(autoCloseTimer);
  asState = state;
  asPop.hidden = false;
  $('#micBtn').classList.toggle('listening', state === 'listening');
  $('#micBtn').classList.toggle('busy', state === 'thinking');
  $('#asState').textContent = label || STATE_LABELS[state] || '';
}
function closeAssistant() {
  clearTimeout(autoCloseTimer);
  asPop.hidden = true;
  $('#micBtn').classList.remove('listening', 'busy');
  asState = 'idle';
  pending = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}
document.addEventListener('mousedown', e => {
  // Kayıt sürerken ya da cevap beklenirken dışarı tıklamak kesmesin; sadece sonuç gösterilirken kapatsın
  if (!asPop.hidden && asState !== 'listening' && asState !== 'thinking' && !e.target.closest('#assistantPop, #micBtn')) closeAssistant();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !asPop.hidden) closeAssistant(); });
$('#asClose').onclick = closeAssistant;

// --- Ana akış ---
async function toggleListening() {
  if (asState === 'listening') return stopAndSend();
  if (asState === 'thinking') return;   // cevap beklenirken yeni kayda başlama
  try {
    await startRecording();
    showPanel('listening');
    $('#asHeard').textContent = '';
    $('#asAnswer').textContent = '';
  } catch {
    showPanel('error');
    $('#asAnswer').textContent = 'Mikrofona erişilemedi. Windows ayarlarından Panel\'e mikrofon izni verildiğinden emin ol.';
  }
}
async function stopAndSend() {
  clearTimeout(recordTimeout);
  showPanel('thinking');
  const blob = await stopRecordingRaw();
  try {
    const wav = await blobToWav(blob);
    const res = await api.assistant.ask(wav, 'audio/wav', tasksContext());
    handleResponse(res);
  } catch (err) {
    const msg = cleanErr(err);
    $('#asHeard').textContent = '';
    $('#asAnswer').textContent = msg;
    speak(`Bir sorun oluştu: ${msg}`);
    showPanel('error');
    autoCloseTimer = setTimeout(closeAssistant, 6000);
  }
}

async function handleResponse(res) {
  $('#asHeard').textContent = res.heard ? `"${res.heard}"` : '';
  $('#asAnswer').textContent = res.speech || '';

  if (res.type === 'need_category') {
    pending = { text: res.task_text || '', due: res.due || null, rec: res.rec || null };
    showPanel('asking');
    await speak(res.speech);
    // Soru bitince mikrofonu otomatik aç; hâlâ "asking" durumundaysak (kullanıcı araya girip
    // kapatmadıysa) kaydı başlat.
    if (asState === 'asking') toggleListening();
    return;
  }

  pending = null;
  if (res.type === 'add_task' && res.task_text) {
    const cat = resolveCategory(res.category);
    selectCat(cat.name);
    addTask(cat, res.task_text, res.due || null, res.rec || null);
    showPanel('added');
  } else {
    if (res.highlight_date) openCalDay(res.highlight_date);
    showPanel('answer');
  }
  await speak(res.speech);
  autoCloseTimer = setTimeout(closeAssistant, 4000);
}

$('#micBtn').onclick = toggleListening;
api.assistant.onTrigger(toggleListening);
document.addEventListener('keydown', e => {
  // Ctrl+Alt+V global kısayolun yanında, pencere odaktayken de çalışsın
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'v') { e.preventDefault(); toggleListening(); }
});
