// ============ Kategoriler ve görevler (bulut) ============
// Tüm kategoriler (kişisel ve ortak) Firestore'dadır; todo.cats bu bulut verisinin bellekteki halidir.
// Kişisel kategori = tek üyeli kategori; üye eklenince ortak olur (cat.shared = birden fazla üye).
//   { name, tasks, cid, sahip, uyeler, uyeAdlari, icon, deleted, shared, base: Map(görev id → imza) }
// Görev nesneleri: { done, text, due, rec, created, completed, time, remind, priority, level, id, createdBy, assignees, completedBy, parentId, sira }.
// Alt görevler buluttaki "ust" alanıyla (üst görevin kimliği), sıra "sira" alanıyla (küçük olan üstte) tutulur.
// Yazma yolu: arayüz görevi her zamanki gibi değiştirir, saveTodos() → pushShared() imzası değişenleri buluta gönderir.
// Okuma yolu: Firestore dinleyicileri görevleri bu nesnelere işler (applyTasks).
// todo.md artık kaynak değildir: bulutun otomatik yedeğidir (scheduleMirror).
let sync = null;   // { email, unsubCats, unsubOrder, taskUnsubs: Map(cid → unsub), catsLoaded } — yalnızca giriş yapılmış ve izinli hesapta

const cloudCats = () => todo.cats.filter(c => c.cid);
// Buluta giden alanlar (Firestore alan adlarıyla); imza değişimi hangi alanların gönderileceğini belirler
const fieldsOf = (t, ust) => ({
  metin: t.text, bitti: !!t.done, son: t.due || null, tekrar: t.rec || null, atananlar: t.assignees || [],
  saat: t.time || null, hatirlat: t.remind || [], oncelik: t.priority || null, ust: ust || null, sira: t.sira ?? null,
});
const sigOf = (t, ust) => JSON.stringify(fieldsOf(t, ust));
// Görevin üst görevi: listedeki konumundan (alt görev = üstündeki daha az girintili görev); üstü yüklenmemiş (yetim) görev eski üstünü korur
const ustOf = (cat, t) => parentOf(cat.tasks, cat.tasks.indexOf(t))?.id || t.orphanOf || null;
const stampOfMs = ms => ms == null ? undefined : new Date(ms).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T');
// Kişisel istatistikler: başkasının tamamladığı ortak görev sayılmaz; başkasına atanmış açık görev de benim yükümde değildir
const ownDone = t => !t.completedBy || !sync || t.completedBy === sync.email;
const onMyPlate = t => !t.assignees?.length || !sync || t.assignees.includes(sync.email);
const isMine = t => !!sync && !!t.assignees?.includes(sync.email);
const memberName = (cat, email) => cat.uyeAdlari[email] || email.split('@')[0];
const isOwner = cat => !!sync && cat.sahip === sync.email;

function taskFromDoc(d) {
  return {
    id: d.id, done: d.bitti, text: d.metin, due: d.son || undefined, rec: d.tekrar || undefined,
    created: d.eklendi || stampOfMs(d.olusturma), completed: d.bitti ? stampOfMs(d.bitirmeZamani) : undefined,
    createdBy: d.olusturan, completedBy: d.bitiren || undefined,
    // eski belgelerde tek "atanan" vardı; yenilerde "atananlar" listesi (varsa o geçerli)
    assignees: (d.atananlar ?? (d.atanan ? [d.atanan] : [])).length ? [...(d.atananlar ?? [d.atanan])] : undefined,
    time: d.saat || undefined, remind: d.hatirlat?.length ? [...d.hatirlat] : undefined, priority: d.oncelik || undefined,
    parentId: d.ust || undefined, sira: typeof d.sira === 'number' ? d.sira : undefined,
    ts: d.olusturma || Date.now(), doneTs: d.bitirmeZamani || 0,
  };
}
// Sıra: önce yapılmamışlar, sonra "sira" (küçük üstte); sırası olmayan eski görevler oluşturma zamanına göre (yeni üstte)
const effSira = t => t.sira ?? (t.ts ? -t.ts / 1000 : undefined);
const cmpSira = (a, b) => (a.done - b.done) || ((effSira(a) ?? 0) - (effSira(b) ?? 0)) || ((b.ts || 0) - (a.ts || 0));
function sortSharedTree(tasks) {
  const byId = new Map(tasks.filter(t => t.id).map(t => [t.id, t]));
  const kids = new Map(), roots = [];
  for (const t of tasks) {
    const p = t.parentId && byId.get(t.parentId);
    if (p && p !== t) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(t); delete t.orphanOf; }
    else { roots.push(t); if (t.parentId) t.orphanOf = t.parentId; else delete t.orphanOf; }
  }
  const out = [], seen = new Set();
  const walk = (t, level) => {
    if (seen.has(t)) return;
    seen.add(t);
    if (level) t.level = level; else delete t.level;
    out.push(t);
    for (const k of (kids.get(t) || []).sort(cmpSira)) walk(k, Math.min(level + 1, MAX_LEVEL));
  };
  roots.sort(cmpSira).forEach(t => walk(t, 0));
  tasks.forEach(t => walk(t, 0));   // üst görev döngüsü gibi beklenmedik durumda görev kaybolmasın
  return out;
}

// Liste sırası → "sira" değerleri. Kardeşler (aynı üst görevin altındakiler) liste sırasında artan "sira"ya sahip olmalı;
// zaten sıralı olanlar (en uzun artan altdizi) korunur, yalnızca yeri değişen görevlere yeni değer verilir → tek bir yazma.
function assignSira(cat) {
  const sibs = new Map(), stack = [];
  for (const t of cat.tasks) {
    while (stack.length && lvl(stack[stack.length - 1]) >= lvl(t)) stack.pop();
    const p = stack[stack.length - 1] || null;
    if (!sibs.has(p)) sibs.set(p, []);
    sibs.get(p).push(t);
    stack.push(t);
  }
  for (const list of sibs.values()) {
    const n = list.length, v = list.map(effSira);
    // en uzun artan altdizi (değeri olanlar arasında), O(n²) yeterli
    const len = Array(n).fill(0), prev = Array(n).fill(-1);
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (v[i] === undefined) continue;
      len[i] = 1;
      for (let j = 0; j < i; j++) if (v[j] !== undefined && v[j] < v[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
      if (best < 0 || len[i] > len[best]) best = i;
    }
    const keep = new Set();
    for (let i = best; i >= 0; i = prev[i]) keep.add(i);
    for (let i = 0; i < n;) {
      if (keep.has(i)) { i++; continue; }
      let j = i;
      while (j < n && !keep.has(j)) j++;
      const lo = i > 0 ? v[i - 1] : undefined, hi = j < n ? v[j] : undefined;   // komşu korunan değerler (komşular yeni değer aldıysa v güncel tutulur)
      const m = j - i;
      for (let k = 0; k < m; k++) {
        const val = lo === undefined && hi === undefined ? k * 1024
          : lo === undefined ? hi - (m - k) * 1024
          : hi === undefined ? lo + (k + 1) * 1024
          : lo + (hi - lo) * (k + 1) / (m + 1);
        list[i + k].sira = val;
        v[i + k] = val;
      }
      i = j;
    }
    // Değerler birbirine çok yaklaştıysa (hassasiyet) tüm kardeşleri yeniden numaralandır
    for (let i = 1; i < n; i++) if (v[i] - v[i - 1] < 1e-6) { list.forEach((t, k) => { t.sira = k * 1024; }); break; }
  }
}

// Başka bir kategoriye taşınan görev yeni belge olur (kategoriler arası taşıma = kopyala + eskisini sil)
const copyTask = t => ({
  done: t.done, text: t.text, due: t.due, rec: t.rec, time: t.time, remind: t.remind && [...t.remind], priority: t.priority,
  assignees: undefined, ...(t.level ? { level: t.level } : {}), created: t.created || stampNow(), completed: t.completed, sira: undefined,
});

// --- Kategori sırası: kişiye özel (users/{uid}/tercihler/kategori); bellekte cids dizisi ---
let catOrderIds = [];
function applyCatOrder() {
  const idx = c => { const i = catOrderIds.indexOf(c.cid); return i < 0 ? 1e9 + (c.ts || 0) / 1e6 : i; };
  todo.cats.sort((a, b) => idx(a) - idx(b));
}
let orderTimer = null;
function saveCatOrder() {
  if (!sync) return;
  clearTimeout(orderTimer);
  orderTimer = setTimeout(() => {
    const ids = todo.cats.map(c => c.cid).filter(Boolean);
    if (JSON.stringify(ids) === JSON.stringify(catOrderIds)) return;
    catOrderIds = ids;
    cloud.setCatOrder(ids).catch(syncError);
  }, 800);
}

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
let syncErrCode = null;
const syncLog = [];   // son uyarılar: { at, text }
function syncError(e) {
  console.error(e);
  const el = $('#syncNote');
  syncErrCode = e?.code;
  syncLog.unshift({ at: Date.now(), text: cloudErrorText(e) });
  syncLog.length = Math.min(syncLog.length, 10);
  el.hidden = false;
  el.title = `Bulutla eşitlenemedi: ${cloudErrorText(e)} (ayrıntı için tıkla)`;
}
// Bağlantı kopması geçicidir: sunucudan haber gelince ⚠ kalkar (kural reddi gibi kalıcı hatalar kalır)
const clearNetError = () => { if (syncErrCode === 'unavailable') clearSyncNote(); };
function clearSyncNote() { $('#syncNote').hidden = true; syncErrCode = null; syncLog.length = 0; }
// Bir yazma sunucuda kabul edilirse önceki yetki/kural uyarısı da geçmiştir (ör. kurallar yayınlandı)
const syncOk = () => { if (syncErrCode === 'permission-denied') clearSyncNote(); };
$('#syncNote').onclick = () => {
  $('#syncList').innerHTML = syncLog.map(x => `<li><span class="tl-main"><span class="tl-text">${esc(x.text)}</span><span class="muted">${esc(fmtStamp.format(new Date(x.at)))}</span></span></li>`).join('') || '<li class="muted">Kayıtlı uyarı yok.</li>';
  $('#syncDlg').showModal();
};
$('#syncClear').onclick = () => { clearSyncNote(); $('#syncDlg').close(); };

// --- Buluttan gelenler ---
function applyCategories(docs) {
  clearNetError();
  const ids = new Set(docs.map(d => d.id));
  for (const cat of cloudCats()) {
    if (ids.has(cat.cid) || cat.pending) continue;   // yeni açılan kategori sunucudan henüz gelmemiş olabilir
    sync.taskUnsubs.get(cat.cid)?.();
    sync.taskUnsubs.delete(cat.cid);
    todo.cats.splice(todo.cats.indexOf(cat), 1);
  }
  for (const d of docs) {
    let cat = cloudCats().find(c => c.cid === d.id);
    if (!cat) {
      cat = { name: d.ad, tasks: [], cid: d.id, base: new Map() };
      todo.cats.push(cat);
    }
    delete cat.pending;
    Object.assign(cat, {
      name: d.ad, sahip: d.sahip, uyeler: d.uyeler, uyeAdlari: d.uyeAdlari || {}, icon: d.simge || undefined,
      deleted: d.silindi === true, silinme: d.silinmeZamani || null, shared: d.uyeler.length > 1, ts: d.olusturma || 0,
    });
    if (membersCid === d.id) renderMembers(membersMsg);
    // Silinmiş kategorinin görevleri dinlenmez (Silinenler'den geri getirilince dinleme başlar)
    if (cat.deleted) { sync.taskUnsubs.get(d.id)?.(); sync.taskUnsubs.delete(d.id); }
    else if (!sync.taskUnsubs.has(d.id)) sync.taskUnsubs.set(d.id, watchCatTasks(d.id));
  }
  applyCatOrder();
  sync.catsLoaded = true;
  // İlk yüklemede: eski yerel görevler varsa taşıma sorulur; yoksa ve hiç kategori da yoksa ilk kategori ("Genel") açılır
  if (!sync.migChecked) {
    sync.migChecked = true;
    checkMigration().then(() => { if (mirrorOk && !activeCats().length) createCategory(GENERAL); }).catch(console.error);
  }
  renderWhenIdle();
  scheduleMirror();
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
  clearNetError();
  const cat = cloudCats().find(c => c.cid === cid);
  if (!cat) return;
  const known = new Map(cat.tasks.filter(t => t.id).map(t => [t.id, t]));
  cat.base = new Map();
  const tasks = docs.map(d => {
    const fresh = taskFromDoc(d);
    const t = known.get(d.id);
    // Başkası bana görev atadıysa (ilk yükleme dışında; kendi değişikliğim bellekte zaten işlenmiş olur) bildir
    if (cat.loaded && !fresh.done && fresh.assignees?.includes(sync.email) && (t ? !t.assignees?.includes(sync.email) : fresh.createdBy !== sync.email)) {
      notifyAssigned(cat, fresh);
    }
    // var olan nesne korunur (sürükleme/düzenleme referansları); belgede olmayan alanlar da temizlenir
    if (t) for (const k of ['assignees', 'time', 'remind', 'priority', 'parentId', 'completedBy', 'due', 'rec', 'completed', 'sira', 'level']) delete t[k];
    if (t) Object.assign(t, fresh);
    return t || fresh;
  });
  cat.loaded = true;
  // Henüz buluta gönderilmemiş (id'siz) görevler kalır
  cat.tasks = sortSharedTree([...cat.tasks.filter(t => !t.id), ...tasks]);
  // Konum belli olunca (üst görev + yetim bilgisi) bulutla aynı olan imzalar kaydedilir
  for (const t of cat.tasks) if (t.id) cat.base.set(t.id, sigOf(t, ustOf(cat, t)));
  renderWhenIdle();
  scheduleMirror();
}

// --- Yerel yedek (todo.md): bulutun otomatik aynası; her değişiklikten birkaç saniye sonra yazılır (Otomatik yedek de bu dosyayı kopyalar) ---
// Bulut tek kaynaktır; bu dosya yalnızca yedek ve (gerekirse) başka araçla okumak içindir, elle düzenlenmez.
let mirrorTimer = null, mirrorLast = 0;
function scheduleMirror() {
  if (!sync || !sync.catsLoaded || !mirrorOk || mirrorTimer) return;
  const wait = Math.max(4000, mirrorLast + 15000 - Date.now());   // en fazla 15 sn'de bir
  mirrorTimer = setTimeout(async () => {
    mirrorTimer = null;
    if (!sync || cloudCats().some(c => !c.deleted && !c.loaded)) return scheduleMirror();   // görevler gelmeden dosyayı eksik yazma
    mirrorLast = Date.now();
    api.todos.write(serializeTodos()).catch(console.error);
  }, wait);
}

// --- Buluta gidenler: imzası değişen/yeni görevleri yaz, listeden kalkanları yumuşak sil ---
function pushShared() {
  if (!sync) return;
  const me = sync.email;
  for (const cat of cloudCats()) {
    if (cat.deleted) continue;
    assignSira(cat);
    const live = new Set();
    for (const t of cat.tasks) {
      if (!t.id) {
        t.id = cloud.newId();
        t.createdBy = me;
        t.ts = Date.now();
        const ust = ustOf(cat, t);
        cat.base.set(t.id, sigOf(t, ust));
        cloud.createTask(cat.cid, t.id, {
          ...fieldsOf(t, ust), olusturan: me, atanan: null, eklendi: t.created || null,
          bitiren: t.done ? me : null, bitirmeZamani: t.done ? (t.completed ? cloud.stampTs(t.completed) : cloud.now()) : null, silindi: false, silenKisi: null,
        }).then(syncOk, syncError);
        if (t.done) { t.completedBy = me; t.doneTs = Date.now(); }
      } else if (cat.base.get(t.id) !== sigOf(t, ustOf(cat, t))) {
        const was = JSON.parse(cat.base.get(t.id) || '{}');
        // Yalnızca değişen alanlar gönderilir: başkasının aynı anda başka bir alanda yaptığı değişiklik ezilmesin
        const ust = ustOf(cat, t), now = fieldsOf(t, ust);
        const patch = {};
        for (const k of Object.keys(now)) if (JSON.stringify(was[k]) !== JSON.stringify(now[k])) patch[k] = now[k];
        if ('atananlar' in patch) patch.atanan = null;   // eski tek atanan alanı artık kullanılmaz
        if (!!was.bitti !== !!t.done) {
          // Tamamlama sayacı: yalnızca benim tamamladıklarım sayılır; geri alınca o günkü sayı düşer
          if (t.done) statsOnDone(cat, t, 1); else if (t.completedBy === me) statsOnDone(cat, { ...t, completed: t.completed || stampOfMs(t.doneTs) }, -1);
          patch.bitiren = t.done ? me : null;
          patch.bitirmeZamani = t.done ? cloud.now() : null;
          t.completedBy = t.done ? me : undefined;
          t.doneTs = t.done ? Date.now() : 0;
        }
        cat.base.set(t.id, sigOf(t, ust));
        cloud.updateTask(cat.cid, t.id, patch).then(syncOk, syncError);
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

// --- Tamamlama sayaçları (istatistik): users/{uid}/istatistik/ozet; yalnızca benim tamamladıklarım ---
function statsOnDone(cat, t, sign) {
  const day = (t.completed || stampNow()).slice(0, 10);
  const mins = t.created && t.completed ? Math.max(0, Math.round((new Date(t.completed) - new Date(t.created)) / 6e4)) : 0;
  cloud.statsAdd(cat.cid, day, sign, sign * mins, t.created && t.completed ? sign : 0).catch(syncError);
}

// --- Kategori işlemleri ---
// Kategori hemen listede görünür (bekleyen); buluttan onay gelince birleşir. Aynı anda eklenen görevler sırayla yazıldığı için kurallar kategoriyi görür.
function createCategory(name) {
  const id = cloud.newId(), me = sync.email;
  const cat = { name, tasks: [], cid: id, base: new Map(), sahip: me, uyeler: [me], uyeAdlari: { [me]: cloud.user.ad || '' }, ts: Date.now(), loaded: true, pending: true };
  todo.cats.push(cat);
  catOrderIds = todo.cats.map(c => c.cid).filter(Boolean);
  cloud.createCategory(id, name).then(() => cloud.setCatOrder(catOrderIds)).catch(syncError);
  renderWhenIdle();
  return cat;
}
function renameCloudCategory(cat, name) { cloud.updateCategory(cat.cid, { ad: name }).catch(syncError); }
// Kategori silinmez, "silindi" işaretlenir (Silinenler'den geri getirilir)
function softDeleteCategory(cat) { cloud.updateCategory(cat.cid, { silindi: true, silinmeZamani: cloud.now() }).catch(syncError); }
function restoreCloudCategory(cat) { cloud.updateCategory(cat.cid, { silindi: false }).catch(syncError); }

// --- Oturuma bağlı yaşam döngüsü ---
function stopSharedSync() {
  if (!sync) return;
  sync.unsubCats();
  sync.unsubOrder?.();
  sync.taskUnsubs.forEach(u => u());
  sync = null;
  todo.cats = [];
  catOrderIds = [];
  $('#syncNote').hidden = true;
  renderTodos();
}
function startSharedSync(user) {
  if (sync && sync.email === user.email) return;
  stopSharedSync();
  sync = { email: user.email, taskUnsubs: new Map(), catsLoaded: false };
  sync.unsubOrder = cloud.watchCatOrder(ids => { catOrderIds = ids; applyCatOrder(); renderWhenIdle(); }, syncError);
  sync.unsubCats = cloud.watchCategories(user.email, applyCategories, syncError);
  cloud.loadStats().then(() => renderStats()).catch(syncError);
}
cloud.onChange(user => {
  if (user && user.active) startSharedSync(user); else stopSharedSync();
});

// ============ Atama ============
// Birden fazla kişi atanabilir: düğmede ilk üçünün baş harfi (fazlası "+N"), ipucunda tüm adlar
const assigneeButtonHtml = (cat, task) => {
  const list = task.assignees || [];
  if (!list.length) return '<button class="asg none" title="Birine ata">＋</button>';
  const me = list.includes(sync?.email);
  const ini = e => esc(memberName(cat, e).charAt(0).toLocaleUpperCase('tr'));
  return `<button class="asg set${me ? ' me' : ''}" title="Atananlar: ${esc(list.map(e => memberName(cat, e)).join(', '))}">${list.slice(0, 3).map(ini).join('')}${list.length > 3 ? `+${list.length - 3}` : ''}</button>`;
};
const assignPop = $('#assignPop');
function closeAssignPop() { assignPop.hidden = true; }
// Çoklu seçim: her üyeye tıklamak atamayı açıp kapatır; pencere açık kalır ("Temizle" hepsini kaldırır)
function pickAssignee(anchor, cat, task) {
  const draw = () => {
    const sel = new Set(task.assignees || []);
    assignPop.innerHTML = cat.uyeler.map(e => `<button type="button" data-e="${esc(e)}" class="${sel.has(e) ? 'on' : ''}"><span class="chk">${sel.has(e) ? '✓' : ''}</span>${esc(e === sync.email ? `${memberName(cat, e)} (ben)` : memberName(cat, e))}</button>`).join('')
      + (sel.size ? '<button type="button" data-clear class="clear">Atamaları temizle</button>' : '');
    assignPop.querySelectorAll('[data-e]').forEach(b => b.onclick = () => {
      sel.has(b.dataset.e) ? sel.delete(b.dataset.e) : sel.add(b.dataset.e);
      task.assignees = sel.size ? cat.uyeler.filter(e => sel.has(e)) : undefined;
      saveTodos();   // liste yeniden çizilir; pencere açık kalır ve güncel hali gösterir
      draw();
    });
    assignPop.querySelector('[data-clear]')?.addEventListener('click', () => { task.assignees = undefined; saveTodos(); closeAssignPop(); });
  };
  draw();
  assignPop.hidden = false;
  const r = anchor.getBoundingClientRect(), w = assignPop.offsetWidth, h = assignPop.offsetHeight;
  assignPop.style.left = `${Math.min(Math.max(8, r.left), innerWidth - w - 8)}px`;
  assignPop.style.top = `${Math.max(8, r.bottom + 6 + h > innerHeight - 8 ? r.top - h - 6 : r.bottom + 6)}px`;
}
document.addEventListener('mousedown', e => { if (!assignPop.hidden && !e.target.closest('#assignPop, .asg')) closeAssignPop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAssignPop(); });

// Başkasının bana atadığı yeni görev: sistem bildirimi (uygulama açıkken)
function notifyAssigned(cat, task) {
  try {
    new Notification('Sana görev atandı', { body: `${cat.name}: ${task.text}` });
  } catch (e) { console.error(e); }
}

// ============ Üyeler penceresi ============
let membersCid = null, membersMsg = '';
const membersDlg = $('#membersDlg');
membersDlg.addEventListener('close', () => { membersCid = null; });
function openMembers(cat) {
  membersCid = cat.cid;
  renderMembers('');
  membersDlg.showModal();
}
function renderMembers(msg = '') {
  membersMsg = msg;
  if (!membersCid) return;
  const cat = cloudCats().find(c => c.cid === membersCid);
  if (!cat) { membersCid = null; if (membersDlg.open) membersDlg.close(); return; }
  const owner = isOwner(cat);
  $('#memTitle').textContent = `Üyeler · ${cat.name}`;
  $('#memBody').innerHTML = `
    <ul class="trash-list">${cat.uyeler.map(e => `
      <li><span class="tl-main"><span class="tl-text">${esc(memberName(cat, e))}${e === cat.sahip ? ' <span class="muted">· sahip</span>' : ''}</span>
        <span class="muted">${esc(e)}</span></span>
        ${owner && e !== cat.sahip ? `<button type="button" data-rm="${esc(e)}">Çıkar</button>` : ''}</li>`).join('')}</ul>
    ${owner ? `<div class="mem-add"><input id="memEmail" type="email" placeholder="E-posta" autocomplete="off"><input id="memName" placeholder="Görünecek ad (isteğe bağlı)" autocomplete="off"><button type="button" id="memAdd">Ekle</button></div>
      <p class="muted">Kişinin hesabı yöneticiden açılmış ve izin listesinde olmalı; yoksa kategoriyi göremez.</p>`
      : '<div class="row"><button type="button" id="memLeave">Kategoriden ayrıl</button></div>'}
    <p class="mem-msg">${esc(msg)}</p>`;
  const run = async fn => {
    try { await fn(); } catch (e) { syncError(e); renderMembers(`Olmadı: ${cloudErrorText(e)}`); }
  };
  $('#memBody').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    const email = b.dataset.rm;
    if (!confirm(`${memberName(cat, email)} bu kategoriden çıkarılsın mı?\n\nKişinin görevlerdeki ataması kalkar.`)) return;
    run(() => removeMember(cat, email));
  });
  const leave = $('#memLeave');
  if (leave) leave.onclick = () => {
    if (!confirm(`"${cat.name}" kategorisinden ayrılmak istiyor musun?\n\nSana atanan görevlerin ataması kalkar; tekrar katılmak için sahibinin seni eklemesi gerekir.`)) return;
    run(async () => { await removeMember(cat, sync.email); membersDlg.close(); });
  };
  if (owner) {
    const add = () => run(async () => {
      const email = $('#memEmail').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return renderMembers('E-posta geçersiz.');
      if (cat.uyeler.includes(email)) return renderMembers('Bu kişi zaten üye.');
      if (cat.uyeler.length >= 20) return renderMembers('En fazla 20 üye olabilir.');
      await cloud.setMembers(cat.cid, [...cat.uyeler, email], { ...cat.uyeAdlari, [email]: $('#memName').value.trim() });
      renderMembers('Eklendi.');
    });
    $('#memAdd').onclick = add;
    $('#memBody').querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }));
  }
}
async function removeMember(cat, email) {
  const uyeAdlari = { ...cat.uyeAdlari };
  delete uyeAdlari[email];
  await cloud.removeMember(cat.cid, email, cat.uyeler.filter(e => e !== email), uyeAdlari);
}

// Silinenler penceresi için: tüm ortak kategorilerdeki silinmiş görevler (en yeni üstte)
async function deletedSharedTasks() {
  if (!sync) return [];
  const rows = [];
  for (const cat of cloudCats().filter(c => !c.deleted)) {
    try {
      for (const d of await cloud.listDeletedTasks(cat.cid)) {
        rows.push({ cat, id: d.id, text: d.metin, at: d.guncelleme, by: d.silenKisi ? memberName(cat, d.silenKisi) : '' });
      }
    } catch (e) { syncError(e); }
  }
  return rows.sort((a, b) => (b.at || 0) - (a.at || 0));
}
const restoreSharedTask = r => cloud.updateTask(r.cat.cid, r.id, { silindi: false, silenKisi: null }).catch(syncError);
