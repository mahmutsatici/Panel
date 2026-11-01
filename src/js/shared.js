// ============ Ortak kategoriler (bulut) ============
// Ortak kategori, yerel kategorilerle aynı listede (todo.cats) durur ama kaynağı Firestore'dur; todo.md'ye yazılmaz.
//   { name, tasks, hidden: [], shared: true, cid, sahip, uyeler, uyeAdlari, base: Map(görev id → imza) }
// Görev nesneleri yerelkilerle aynı biçimde (done, text, due, rec, created, completed, time, remind, priority, level) + { id, createdBy, assignees, completedBy, parentId }.
// Alt görevler buluttaki "ust" alanıyla (üst görevin kimliği) tutulur; ekranda level ile sıralanır (sortSharedTree).
// Yazma yolu: arayüz görevi her zamanki gibi değiştirir, saveTodos() → pushShared() imzası değişenleri buluta gönderir.
// Okuma yolu: Firestore dinleyicileri görevleri bu nesnelere işler (applyTasks). Sıralama: oluşturma zamanı (yeni üstte).
let sync = null;   // { email, unsubCats, taskUnsubs: Map(cid → unsub) } — yalnızca giriş yapılmış ve izinli hesapta

const sharedCats = () => todo.cats.filter(c => c.shared);
const sharedKey = cat => cat.shared ? `c:${cat.cid}` : `l:${cat.name}`;
// Buluta giden alanlar (Firestore alan adlarıyla); imza değişimi hangi alanların gönderileceğini belirler
const fieldsOf = (t, ust) => ({
  metin: t.text, bitti: !!t.done, son: t.due || null, tekrar: t.rec || null, atananlar: t.assignees || [],
  saat: t.time || null, hatirlat: t.remind || [], oncelik: t.priority || null, ust: ust || null,
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
    created: stampOfMs(d.olusturma), completed: d.bitti ? stampOfMs(d.bitirmeZamani) : undefined,
    createdBy: d.olusturan, completedBy: d.bitiren || undefined,
    // eski belgelerde tek "atanan" vardı; yenilerde "atananlar" listesi (varsa o geçerli)
    assignees: (d.atananlar ?? (d.atanan ? [d.atanan] : [])).length ? [...(d.atananlar ?? [d.atanan])] : undefined,
    time: d.saat || undefined, remind: d.hatirlat?.length ? [...d.hatirlat] : undefined, priority: d.oncelik || undefined,
    parentId: d.ust || undefined,
    ts: d.olusturma || Date.now(), doneTs: d.bitirmeZamani || 0,
  };
}
// Sıralama: üst düzeyde oluşturma zamanı (yeni üstte, yapılanlar altta); alt görevler üstünün altında, oluşturma sırasıyla (yapılanlar altta)
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
    const c = kids.get(t) || [];
    for (const k of [...c.filter(x => !x.done).sort((a, b) => a.ts - b.ts), ...c.filter(x => x.done).sort((a, b) => a.ts - b.ts)]) walk(k, Math.min(level + 1, MAX_LEVEL));
  };
  [...roots.filter(t => !t.done).sort((a, b) => b.ts - a.ts), ...roots.filter(t => t.done).sort((a, b) => b.doneTs - a.doneTs)].forEach(t => walk(t, 0));
  tasks.forEach(t => walk(t, 0));   // üst görev döngüsü gibi beklenmedik durumda görev kaybolmasın
  return out;
}

// Başka bir kategoriye sürüklenen görev (ortak ↔ yerel) taşınmaz, kopyalanır; kopya yeni bir görevdir
const copyTask = t => ({
  done: t.done, text: t.text, due: t.due, rec: t.rec, time: t.time, remind: t.remind && [...t.remind], priority: t.priority,
  ...(t.level ? { level: t.level } : {}), created: stampNow(), completed: t.completed,
});

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
let syncErrCode = null;
function syncError(e) {
  console.error(e);
  const el = $('#syncNote');
  syncErrCode = e?.code;
  el.hidden = false;
  el.title = `Ortak kategoriler eşitlenemedi: ${cloudErrorText(e)}`;
}
// Bağlantı kopması geçicidir: sunucudan haber gelince ⚠ kalkar (kural reddi gibi kalıcı hatalar kalır)
const clearNetError = () => { if (syncErrCode === 'unavailable') { $('#syncNote').hidden = true; syncErrCode = null; } };

// --- Buluttan gelenler ---
function applyCategories(docs) {
  clearNetError();
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
    Object.assign(cat, { name: d.ad, sahip: d.sahip, uyeler: d.uyeler, uyeAdlari: d.uyeAdlari || {}, icon: store.get('catIcons', {})[`c:${d.id}`] });
    if (membersCid === d.id) renderMembers(membersMsg);
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
  clearNetError();
  const cat = sharedCats().find(c => c.cid === cid);
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
    if (t) for (const k of ['assignees', 'time', 'remind', 'priority', 'parentId', 'completedBy', 'due', 'rec', 'completed']) delete t[k];
    if (t) Object.assign(t, fresh);
    return t || fresh;
  });
  cat.loaded = true;
  // Henüz buluta gönderilmemiş (id'siz) görevler kalır
  cat.tasks = sortSharedTree([...cat.tasks.filter(t => !t.id), ...tasks]);
  // Konum belli olunca (üst görev + yetim bilgisi) bulutla aynı olan imzalar kaydedilir
  for (const t of cat.tasks) if (t.id) cat.base.set(t.id, sigOf(t, ustOf(cat, t)));
  renderWhenIdle();
  writeSharedCopy();
}

// Yerel yedek: ortak kategorilerin son hali, veri klasörüne ortak-kopya.json olarak yazılır (Panel yedekleri buna da dahildir)
const writeSharedCopy = debounce(() => {
  if (!sync) return;
  const cats = sharedCats().map(c => ({
    ad: c.name, id: c.cid, sahip: c.sahip, uyeler: c.uyeler,
    gorevler: c.tasks.map(t => ({ metin: t.text, bitti: t.done, seviye: t.level || 0, son: t.due || null, saat: t.time || null, tekrar: t.rec || null, atananlar: t.assignees || [], oncelik: t.priority || null, hatirlat: t.remind || [], olusturan: t.createdBy || null, bitiren: t.completedBy || null, eklendi: t.created || null, tamamlandi: t.completed || null })),
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
        const ust = ustOf(cat, t);
        cat.base.set(t.id, sigOf(t, ust));
        cloud.createTask(cat.cid, t.id, {
          ...fieldsOf(t, ust), olusturan: me, atanan: null,
          bitiren: t.done ? me : null, bitirmeZamani: t.done ? cloud.now() : null, silindi: false, silenKisi: null,
        }).catch(syncError);
        if (t.done) { t.completedBy = me; t.doneTs = Date.now(); }
      } else if (cat.base.get(t.id) !== sigOf(t, ustOf(cat, t))) {
        const was = JSON.parse(cat.base.get(t.id) || '{}');
        // Yalnızca değişen alanlar gönderilir: başkasının aynı anda başka bir alanda yaptığı değişiklik ezilmesin
        const ust = ustOf(cat, t), now = fieldsOf(t, ust);
        const patch = {};
        for (const k of Object.keys(now)) if (JSON.stringify(was[k]) !== JSON.stringify(now[k])) patch[k] = now[k];
        if ('atananlar' in patch) patch.atanan = null;   // eski tek atanan alanı artık kullanılmaz
        if (!!was.bitti !== !!t.done) {
          patch.bitiren = t.done ? me : null;
          patch.bitirmeZamani = t.done ? cloud.now() : null;
          t.completedBy = t.done ? me : undefined;
          t.doneTs = t.done ? Date.now() : 0;
        }
        cat.base.set(t.id, sigOf(t, ust));
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
  const cat = sharedCats().find(c => c.cid === membersCid);
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
  for (const cat of sharedCats()) {
    try {
      for (const d of await cloud.listDeletedTasks(cat.cid)) {
        rows.push({ cat, id: d.id, text: d.metin, at: d.guncelleme, by: d.silenKisi ? memberName(cat, d.silenKisi) : '' });
      }
    } catch (e) { syncError(e); }
  }
  return rows.sort((a, b) => (b.at || 0) - (a.at || 0));
}
const restoreSharedTask = r => cloud.updateTask(r.cat.cid, r.id, { silindi: false, silenKisi: null }).catch(syncError);
