// Başlangıç: ayarları oku, kartları yerleştir, verileri yükle.
// Bölümler js/ klasöründe: core (ortak), clock, weather, todos, calendar, notes, trash, layout, settings.
async function init() {
  settings = await api.settings.get();

  // Notlardaki göreli resim yolları (resimler/…) notes klasörüne göre çözülsün
  const base = document.createElement('base');
  base.href = settings.notesUrl;
  document.head.prepend(base);

  cloudInit();           // bulut hesabı (isteğe bağlı; yapılandırma yoksa hiçbir şey yapmaz)
  applyTheme();
  applyLayout();
  createEditor();
  applyTheme();          // editör oluştuktan sonra koyu/açık sınıfını ona da uygula
  $('#cardPool').remove();

  renderGreeting();
  applyClockMode();   // saat görünümünü uygular ve ilk kez çizer
  setInterval(tickClock, 1000);
  await Promise.all([loadTodos(), loadNoteList()]);
  const last = store.get('lastNote', null);
  const first = notes.find(n => n.name === last) || notes[0];
  if (first) await openNote(first.name);
  loadWeather();
  setInterval(() => loadWeather(), WEATHER_TTL);
}

// Panel tekrar öne gelince dışarıdan yapılan değişiklikleri (VS Code, Notepad…) al.
window.addEventListener('focus', async () => {
  if (!document.querySelector('.cat-input, .task-input, .cal-add input:focus') && !dragging) loadTodos();
  if (!dirty) {
    await saving;   // kendi kaydımız sürerken okuyup editörü gereksiz yere yenilemeyelim
    await loadNoteList();
    if (current && notes.some(n => n.name === current)) {
      const content = await api.notes.read(current);
      if (content !== lastFile && !dirty) { lastFile = content; setEditorContent(content); }
    }
  }
  if (settings.weatherCache && Date.now() - settings.weatherCache.at > WEATHER_TTL) loadWeather();
});
window.addEventListener('beforeunload', () => { saveNote(); });

init();
