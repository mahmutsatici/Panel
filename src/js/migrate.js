// ============ Yerel görevleri buluta taşıma ============
// Giriş yapılıp bulut yüklenince: bu bilgisayardaki eski todo.md'de görev varsa (ve bu dosya bulutun yedeği değilse) kullanıcıya sorulur.
// Taşıma: dosya yedeklenir (todo-eski-….md) → kategoriler → görevler (alt görev bağlantıları, sıra, özgün eklenme/tamamlanma zamanı)
// → kategori sırası → istatistik sayaçları → sunucu sayımıyla doğrulama. Hiçbir şey silinmez.
// Taşıma bitene (ya da dosyada görev olmadığı anlaşılana) kadar todo.md yedeği yazılmaz (mirrorOk): eski dosya ezilmesin.
let mirrorOk = false;
const MIRROR_TAG = 'panel-bulut-yedek';   // bulut yedeği olan todo.md'nin ilk satırlarında bulunan işaret

async function checkMigration() {
  const raw = await api.todos.read();
  // Bulut yedeği olan dosya ya da yeni kurulumun örnek dosyası (tek örnek görev) taşınacak yerel veri sayılmaz
  const isMirror = raw.includes(MIRROR_TAG) || raw.replace(/\r/g, '').trim() === '# Yapılacaklar\n\n- [ ] Panel uygulamasını keşfet';
  const local = isMirror ? null : parseTodos(raw);
  const count = local ? local.cats.reduce((n, c) => n + c.tasks.length + c.hidden.length, 0) : 0;
  if (!count || settings.cloudMigrated?.email === sync.email) { mirrorOk = true; scheduleMirror(); return; }
  const active = local.cats.filter(c => !c.deleted);
  $('#migText').textContent = `Bu bilgisayardaki todo.md dosyanda ${active.length} kategori ve ${count} görev var. Giriş zorunlu olduğundan görevlerin bulutta tutulacak; böylece her yerden ve ortak çalışmada aynı veriyi görürsün.`;
  $('#migList').innerHTML = active.map(c => `<li><span class="tl-main"><span class="tl-text">${esc(c.name)}</span><span class="muted">${c.tasks.length} görev</span></span></li>`).join('');
  $('#migMsg').textContent = '';
  $('#migBar').hidden = true;
  $('#migGo').disabled = $('#migLater').disabled = false;
  $('#migrateDlg').showModal();
  $('#migLater').onclick = () => $('#migrateDlg').close();   // todo.md'ye dokunulmaz; sonraki açılışta yeniden sorulur
  $('#migGo').onclick = () => runMigration(local).catch(e => { $('#migMsg').textContent = `Olmadı: ${cloudErrorText(e)}. Tekrar deneyebilirsin (yarım kalan işlem kaldığı yerden sürer).`; $('#migGo').disabled = $('#migLater').disabled = false; });
}

const trunc = (s, n) => String(s || '').slice(0, n);
async function runMigration(local) {
  const me = sync.email, bar = $('#migBar'), msg = $('#migMsg');
  $('#migGo').disabled = $('#migLater').disabled = true;
  bar.hidden = false;
  const step = (text, pct) => { msg.textContent = text; bar.value = pct; };
  step('Yedek alınıyor…', 2);
  await api.todos.archive();

  // Yarım kalan önceki deneme: tamamlanan kategoriler tekrar yazılmaz
  const progress = store.get('migProgress', {});
  const cats = local.cats.filter(c => c.tasks.length || c.hidden.length || !c.deleted);
  const total = cats.reduce((n, c) => n + c.tasks.length + c.hidden.length, 0) || 1;
  let written = 0, expected = 0;
  const agg = { g: {}, s: {}, sn: {}, k: {} };
  const order = [];
  const createdIds = [];

  for (const [ci, c] of cats.entries()) {
    if (progress[c.name] && progress[c.name].done) { written += c.tasks.length + c.hidden.length; expected += progress[c.name].n; createdIds.push([c, progress[c.name].cid]); continue; }
    const cid = progress[c.name]?.cid || cloud.newId();
    step(`"${c.name}" kategorisi oluşturuluyor…`, 5 + 85 * written / total);
    if (!progress[c.name]) {
      await cloud.createCategory(cid, trunc(c.name, 60), { ...(c.icon ? { simge: trunc(c.icon, 16) } : {}), ...(c.deleted ? { silindi: true, silinmeZamani: cloud.now() } : {}) });
      progress[c.name] = { cid }; store.set('migProgress', progress);
    }
    // Görev belgeleri: alt görev bağlantısı (ust) ve sıra (sira) liste sırasından
    const items = [], stack = [], counters = new Map();
    for (const t of c.tasks) {
      if (!t.text) continue;
      while (stack.length && lvl(stack[stack.length - 1]) >= lvl(t)) stack.pop();
      const parent = stack[stack.length - 1] || null;
      const idx = counters.get(parent) || 0;
      counters.set(parent, idx + 1);
      t.id = cloud.newId();
      stack.push(t);
      const completed = t.done ? (t.completed || t.created || stampNow()) : null;
      items.push({ id: t.id, data: {
        metin: trunc(t.text, 500), bitti: !!t.done, son: t.due || null, tekrar: t.rec || null, atananlar: [], atanan: null,
        saat: t.time || null, hatirlat: t.remind || [], oncelik: t.priority || null, ust: parent?.id || null, sira: idx * 1024,
        olusturan: me, eklendi: t.created ? trunc(t.created, 20) : null,
        bitiren: t.done ? me : null, bitirmeZamani: t.done ? cloud.stampTs(completed) : null, silindi: false, silenKisi: null,
      } });
      if (t.done && !c.deleted) {
        const day = completed.slice(0, 10), k = cloud.statDay(day);
        agg.g[k] = (agg.g[k] || 0) + 1;
        agg.k[cid] = (agg.k[cid] || 0) + 1;
        if (t.created) { agg.s[k] = (agg.s[k] || 0) + Math.max(0, Math.round((new Date(completed) - new Date(t.created)) / 6e4)); agg.sn[k] = (agg.sn[k] || 0) + 1; }
      }
    }
    // Eskiden silinmiş görevler (Silinenler'de görünsün)
    for (const line of c.hidden) {
      const t = parseTaskLine(line.replace(DEL_RE, ''));
      if (!t || !t.text) continue;
      items.push({ id: cloud.newId(), data: {
        metin: trunc(t.text, 500), bitti: !!t.done, son: t.due || null, tekrar: t.rec || null, atananlar: [], atanan: null,
        saat: t.time || null, hatirlat: t.remind || [], oncelik: t.priority || null, ust: null, sira: null,
        olusturan: me, eklendi: t.created ? trunc(t.created, 20) : null,
        bitiren: t.done ? me : null, bitirmeZamani: t.done ? cloud.stampTs(t.completed || t.created || stampNow()) : null, silindi: true, silenKisi: me,
      } });
    }
    await cloud.writeTasks(cid, items, n => step(`"${c.name}": ${n} / ${items.length} görev yazıldı…`, 5 + 85 * (written + n) / total));
    written += c.tasks.length + c.hidden.length;
    expected += items.length;
    progress[c.name] = { cid, done: true, n: items.length }; store.set('migProgress', progress);
    createdIds.push([c, cid]);
  }

  step('Sıra ve istatistikler yazılıyor…', 92);
  const orderIds = createdIds.filter(([c]) => !c.deleted).map(([, id]) => id);
  await cloud.setCatOrder([...orderIds, ...todo.cats.map(c => c.cid).filter(id => id && !orderIds.includes(id))]);
  await cloud.statsMerge(agg);

  step('Sunucudaki kayıtlar sayılıyor…', 96);
  let actual = 0;
  for (const [, cid] of createdIds) actual += await cloud.countTasks(cid);
  if (actual < expected) throw new Error(`Doğrulama tutmadı: ${expected} görev yazılmalıydı, sunucuda ${actual} var`);

  settings = await api.settings.set({ cloudMigrated: { at: new Date().toISOString(), email: me, kategori: createdIds.length, gorev: expected } });
  store.set('migProgress', {});
  step(`Tamam: ${createdIds.length} kategori, ${expected} görev buluta taşındı ve doğrulandı ✓`, 100);
  mirrorOk = true;
  scheduleMirror();
  setTimeout(() => $('#migrateDlg').close(), 2500);
}
