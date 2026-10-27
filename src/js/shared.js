// ============ Ortak kategoriler (bulut) ============
// Ortak kategori, yerel kategorilerle aynı listede (todo.cats) durur ama kaynağı Firestore'dur; todo.md'ye yazılmaz.
//   { name, tasks, hidden: [], shared: true, cid, sahip, uyeler, uyeAdlari, base: Map(görev id → imza) }
// Görev nesneleri yerelkilerle aynı biçimde (done, text, due, rec, created, completed) + { id, createdBy, assignee, completedBy }.
// Yazma yolu: arayüz görevi her zamanki gibi değiştirir, saveTodos() → pushShared() imzası değişenleri buluta gönderir.
// Okuma yolu: Firestore dinleyicileri görevleri bu nesnelere işler (applyTasks). Sıralama: oluşturma zamanı (yeni üstte).
let sync = null;   // { email, unsubCats, taskUnsubs: Map(cid → unsub) } — yalnızca giriş yapılmış ve izinli hesapta

const sharedCats = () => todo.cats.filter(c => c.shared);
const sharedKey = cat => cat.shared ? `c:${cat.cid}` : `l:${cat.name}`;
const sigOf = t => JSON.stringify([t.text, !!t.done, t.due || null, t.rec || null, t.assignee || null]);
const stampOfMs = ms => ms == null ? undefined : new Date(ms).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T');
const isOwner = cat => !!sync && cat.sahip === sync.email;

function taskFromDoc(d) {
  return {
    id: d.id, done: d.bitti, text: d.metin, due: d.son || undefined, rec: d.tekrar || undefined,
    created: stampOfMs(d.olusturma), completed: d.bitti ? stampOfMs(d.bitirmeZamani) : undefined,
    createdBy: d.olusturan, assignee: d.atanan || undefined, completedBy: d.bitiren || undefined,
    ts: d.olusturma || Date.now(), doneTs: d.bitirmeZamani || 0,
  };
}
const sortShared = tasks => [
  ...tasks.filter(t => !t.done).sort((a, b) => b.ts - a.ts),
  ...tasks.filter(t => t.done).sort((a, b) => b.doneTs - a.doneTs),
];

// Başka bir kategoriye sürüklenen görev (ortak ↔ yerel) taşınmaz, kopyalanır; kopya yeni bir görevdir
const copyTask = t => ({ done: t.done, text: t.text, due: t.due, rec: t.rec, created: stampNow(), completed: t.completed });

// --- Yerleşim: ortak kategorinin listedeki yeri cihazda hatırlanır (todo.md yalnızca yerel olanları tutar) ---
function placeShared(cat) {
  const at = store.get('catOrder', []).indexOf(sharedKey(cat));
  if (at === -1) todo.cats.push(cat); else todo.cats.splice(Math.min(at, todo.cats.length), 0, cat);
}
const saveCatOrder = () => { if (sync) store.set('catOrder', todo.cats.map(sharedKey)); };

// --- Ekran: yazı yazarken / sürüklerken liste yeniden çizilmez, kısa süre sonra yeniden denenir ---
let renderTimer = null;
function renderWhenIdle() {
  if (renderTimer) return;
  const tryRender = () => {
    if (document.querySelector('.cat-input, .task-input') || dragging) { renderTimer = setTimeout(tryRender, 1000); return; }
    renderTimer = null;
    renderTodos();
  };
  tryRender();
}

// --- Hata bildirimi (ör. kural reddi, çevrimdışı yazma): başlıktaki ⚠ üstünde ipucu ---
function syncError(e) {
  console.error(e);
  const el = $('#syncNote');
  el.hidden = false;
  el.title = `Ortak kategoriler eşitlenemedi: ${e?.code || e?.message || e}`;
}

// --- Buluttan gelenler ---
function applyCategories(docs) {
  const ids = new Set(docs.map(d => d.id));
  for (const cat of sharedCats()) {
    if (ids.has(cat.cid)) continue;
    sync.taskUnsubs.get(cat.cid)?.();
    sync.taskUnsubs.delete(cat.cid);
    todo.cats.splice(todo.cats.indexOf(cat), 1);
  }
  const fresh = [];
  for (const d of docs) {
    let cat = sharedCats().find(c => c.cid === d.id);
    if (!cat) {
      cat = { name: d.ad, tasks: [], hidden: [], shared: true, cid: d.id, base: new Map() };
      fresh.push(cat);
    }
    Object.assign(cat, { name: d.ad, sahip: d.sahip, uyeler: d.uyeler, uyeAdlari: d.uyeAdlari || {} });
    if (!sync.taskUnsubs.has(d.id)) {
      sync.taskUnsubs.set(d.id, watchCatTasks(d.id));
    }
  }
  const order = store.get('catOrder', []);
  fresh.sort((a, b) => order.indexOf(sharedKey(a)) - order.indexOf(sharedKey(b)));
  fresh.forEach(placeShared);
  renderWhenIdle();
}

// Görev dinleyicisi hatayla ölürse (ör. yeni kategori sunucuya henüz ulaşmadan dinlenmeye başlandı → permission-denied)
// birkaç kez, kısa aralıkla yeniden kurulur; sonunda olmazsa ⚠ gösterilir.
function watchCatTasks(cid, attempt = 0) {
  let dead = false;
  const unsub = cloud.watchTasks(cid, tasks => { attempt = 0; applyTasks(cid, tasks); }, e => {
    if (dead) return;
    dead = true;
    unsub();
    if (!sync?.taskUnsubs.has(cid)) return;
    if (attempt >= 5) return syncError(e);
    const t = setTimeout(() => { if (sync?.taskUnsubs.has(cid)) sync.taskUnsubs.set(cid, watchCatTasks(cid, attempt + 1)); }, 2000);
    sync.taskUnsubs.set(cid, () => clearTimeout(t));
  });
  return () => { dead = true; unsub(); };
}

function applyTasks(cid, docs) {
  const cat = sharedCats().find(c => c.cid === cid);
  if (!cat) return;
  const known = new Map(cat.tasks.filter(t => t.id).map(t => [t.id, t]));
  cat.base = new Map();
  const tasks = docs.map(d => {
    const fresh = taskFromDoc(d);
    const t = known.get(d.id);
    if (t) Object.assign(t, fresh);   // var olan nesne korunur (sürükleme/düzenleme referansları)
    const task = t || fresh;
    cat.base.set(task.id, sigOf(task));
    return task;
  });
  // Henüz buluta gönderilmemiş (id'siz) görevler kalır
  cat.tasks = sortShared([...cat.tasks.filter(t => !t.id), ...tasks]);
  renderWhenIdle();
  writeSharedCopy();
}

// Yerel yedek: ortak kategorilerin son hali, veri klasörüne ortak-kopya.json olarak yazılır (Panel yedekleri buna da dahildir)
const writeSharedCopy = debounce(() => {
  if (!sync) return;
  const cats = sharedCats().map(c => ({
    ad: c.name, id: c.cid, sahip: c.sahip, uyeler: c.uyeler,
    gorevler: c.tasks.map(t => ({ metin: t.text, bitti: t.done, son: t.due || null, tekrar: t.rec || null, atanan: t.assignee || null, olusturan: t.createdBy || null, bitiren: t.completedBy || null, eklendi: t.created || null, tamamlandi: t.completed || null })),
  }));
  api.todos.writeShared(JSON.stringify({ hesap: sync.email, kaydedildi: new Date().toISOString(), kategoriler: cats }, null, 1)).catch(console.error);
}, 3000);

// --- Buluta gidenler: imzası değişen/yeni görevleri yaz, listeden kalkanları yumuşak sil ---
function pushShared() {
  if (!sync) return;
  const me = sync.email;
  for (const cat of sharedCats()) {
    const live = new Set();
    for (const t of cat.tasks) {
      if (!t.id) {
        t.id = cloud.newId();
        t.createdBy = me;
        t.ts = Date.now();
        cat.base.set(t.id, sigOf(t));
        cloud.createTask(cat.cid, t.id, {
          metin: t.text, bitti: !!t.done, son: t.due || null, tekrar: t.rec || null, olusturan: me, atanan: t.assignee || null,
          bitiren: t.done ? me : null, bitirmeZamani: t.done ? cloud.now() : null, silindi: false, silenKisi: null,
        }).catch(syncError);
        if (t.done) { t.completedBy = me; t.doneTs = Date.now(); }
      } else if (cat.base.get(t.id) !== sigOf(t)) {
        const was = JSON.parse(cat.base.get(t.id) || '[]');
        const patch = { metin: t.text, bitti: !!t.done, son: t.due || null, tekrar: t.rec || null, atanan: t.assignee || null };
        if (!!was[1] !== !!t.done) {
          patch.bitiren = t.done ? me : null;
          patch.bitirmeZamani = t.done ? cloud.now() : null;
          t.completedBy = t.done ? me : undefined;
          t.doneTs = t.done ? Date.now() : 0;
        }
        cat.base.set(t.id, sigOf(t));
        cloud.updateTask(cat.cid, t.id, patch).catch(syncError);
      }
      live.add(t.id);
    }
    for (const id of [...cat.base.keys()]) {
      if (live.has(id)) continue;
      cat.base.delete(id);
      cloud.updateTask(cat.cid, id, { silindi: true, silenKisi: me }).catch(syncError);
    }
  }
}

// --- Kategori işlemleri ---
function createSharedCategory(name) {
  cloud.createCategory(cloud.newId(), name).catch(syncError);
}
function renameSharedCategory(cat, name) {
  cloud.renameCategory(cat.cid, name).catch(syncError);
}
function deleteSharedCategory(cat) {
  cloud.deleteCategory(cat.cid).catch(syncError);
}

// --- Oturuma bağlı yaşam döngüsü ---
function stopSharedSync() {
  if (!sync) return;
  sync.unsubCats();
  sync.taskUnsubs.forEach(u => u());
  sync = null;
  todo.cats = todo.cats.filter(c => !c.shared);
  $('#syncNote').hidden = true;
  renderTodos();
}
function startSharedSync(user) {
  if (sync && sync.email === user.email) return;
  stopSharedSync();
  sync = { email: user.email, taskUnsubs: new Map() };
  sync.unsubCats = cloud.watchCategories(user.email, applyCategories, syncError);
}
cloud.onChange(user => {
  $('#addSharedCat').hidden = !(user && user.active);
  if (user && user.active) startSharedSync(user); else stopSharedSync();
});
