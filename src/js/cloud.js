// ============ Bulut hesabı (isteğe bağlı) ============
// Giriş yapılmazsa uygulama bugünkü gibi tamamen yerel çalışır. Giriş, ortak kategoriler içindir.
// Firebase'e yalnızca bu dosya dokunur (vendor/cloud.js → window.CloudSDK); ileride başka bir arka uca geçilirse
// değişecek tek yer burasıdır.
const cloud = {
  enabled: false,    // yapılandırma var mı (cloud-config.js ya da emülatör)
  ready: false,      // oturum durumu ilk kez öğrenildi mi
  user: null,        // { uid, email, active, ad } ya da null (active: izin listesinde ve aktif mi)
  db: null,
  listeners: new Set(),
  auth: null,
};

// Firebase hata kodlarını anlaşılır Türkçeye çevirir
const AUTH_ERRORS = {
  'auth/invalid-credential': 'E-posta ya da şifre yanlış.',
  'auth/wrong-password': 'E-posta ya da şifre yanlış.',
  'auth/user-not-found': 'Bu e-postayla bir hesap yok. Hesabı yöneticin açar.',
  'auth/invalid-email': 'E-posta adresi geçersiz.',
  'auth/missing-password': 'Şifreyi yaz.',
  'auth/user-disabled': 'Bu hesap devre dışı bırakılmış.',
  'auth/too-many-requests': 'Çok fazla deneme yapıldı; biraz bekleyip tekrar dene.',
  'auth/network-request-failed': 'İnternet bağlantısı yok ya da sunucuya ulaşılamıyor.',
};
const authError = e => AUTH_ERRORS[e?.code] || `Giriş yapılamadı (${e?.code || e?.message || 'bilinmeyen hata'}).`;

function cloudInit() {
  cloud.started = true;
  const emulator = !!settings.cloudEmulator;   // geliştirme: PANEL_FIREBASE_EMULATOR=1 ile Firebase emülatörüne bağlanır
  const config = emulator ? { apiKey: 'demo-key', authDomain: 'demo-panel.firebaseapp.com', projectId: 'demo-panel', appId: 'demo' } : CLOUD_CONFIG;
  if (!config || !window.CloudSDK) { cloud.ready = true; cloudChanged(); return; }
  const sdk = window.CloudSDK;
  const app = sdk.initializeApp(config);
  cloud.auth = sdk.initializeAuth(app, { persistence: sdk.browserLocalPersistence });
  if (emulator) sdk.connectAuthEmulator(cloud.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  // Çevrimdışı çalışabilmesi için yerel önbellek (IndexedDB) açık; yazılanlar bağlantı gelince gönderilir
  cloud.db = sdk.initializeFirestore(app, { localCache: sdk.persistentLocalCache({ tabManager: sdk.persistentSingleTabManager() }) });
  if (emulator) sdk.connectFirestoreEmulator(cloud.db, '127.0.0.1', 8080);
  cloud.enabled = true;
  sdk.onAuthStateChanged(cloud.auth, async u => {
    cloud.user = u ? { uid: u.uid, email: String(u.email || '').toLowerCase(), active: false, ad: '' } : null;
    cloud.ready = true;
    cloudChanged();
    if (u) cloud.loadProfile();
  });
  // Kullanım sayacı yöneticiye yarım saatte bir (değiştiyse) bildirilir
  setInterval(() => cloud.reportUsage().catch(() => {}), 30 * 60 * 1000);
}

// İzin listesindeki kaydım: aktifse ortak kategoriler açılır. Aktif değilse (ilk giriş) yöneticiye "beni ekle" isteği bırakılır.
cloud.loadProfile = async () => {
  const u = cloud.user, sdk = window.CloudSDK;
  if (!u) return;
  try {
    const snap = await sdk.getDoc(sdk.doc(cloud.db, 'allowed', u.uid));
    cloud.count(1, 0);
    if (cloud.user?.uid !== u.uid) return;
    const d = snap.exists() ? snap.data() : null;
    u.active = !!(d && d.aktif === true);
    u.ad = d?.ad || '';
    u.error = null;
    if (u.active) {
      u.admin = (await sdk.getDoc(sdk.doc(cloud.db, 'admins', u.uid))).exists();
      store.set('profile', { uid: u.uid, active: true, admin: u.admin, ad: u.ad });
      cloud.loadSparkConfig();
      setTimeout(() => cloud.reportUsage().catch(() => {}), 60 * 1000);
    } else {
      try {
        const ref = sdk.doc(cloud.db, 'istekler', u.uid);
        if (!(await sdk.getDoc(ref)).exists()) await sdk.setDoc(ref, { eposta: u.email, zaman: sdk.serverTimestamp() });
        u.requested = true;
      } catch { u.requested = false; }
    }
  } catch (e) {
    // İnternet yokken açılış: daha önce doğrulanmış hesap önbellekteki bilgiyle devam eder (veri Firestore önbelleğinden gelir)
    const p = store.get('profile', null);
    if (e.code === 'unavailable' && p?.uid === u.uid && p.active) Object.assign(u, { active: true, admin: !!p.admin, ad: p.ad || '', error: null });
    else u.error = e.code || e.message;
  }
  cloudChanged();
};

// Spark (Gemini) model ayarları yönetici tarafından merkezden belirlenir (ayarlar/spark): giriş yapılınca okunur ve yerel ayarlara uygulanır.
// Belge yoksa ya da giriş yoksa yerel varsayılanlar geçerli kalır.
cloud.sparkConfig = null;
cloud.loadSparkConfig = async () => {
  try {
    const snap = await fsd().getDoc(fsd().doc(cloud.db, 'ayarlar', 'spark'));
    cloud.count(1, 0);
    if (!snap.exists()) return;
    const d = snap.data();
    cloud.sparkConfig = { geminiModel: d.geminiModel || '', yedekModeller: d.yedekModeller || [], sesModelleri: d.sesModelleri || [] };
    await applySparkConfig();
  } catch (e) { console.error('Spark ayarları okunamadı', e); }
};
async function applySparkConfig() {
  const c = cloud.sparkConfig;
  if (!c) return;
  const patch = { geminiModel: c.geminiModel || settings.geminiModel, geminiFallbackModels: c.yedekModeller.join(','), ttsModels: c.sesModelleri.join(',') };
  if (Object.keys(patch).every(k => patch[k] === settings[k])) return;
  settings = await api.settings.set(patch);
}

// Oturum durumu değişince dinleyenleri (hesap sayfası, ileride ortak kategoriler) haberdar et
function cloudChanged() { cloud.listeners.forEach(fn => { try { fn(cloud.user); } catch (e) { console.error(e); } }); }
cloud.onChange = fn => { cloud.listeners.add(fn); return () => cloud.listeners.delete(fn); };

cloud.signIn = async (email, password) => {
  try { await window.CloudSDK.signInWithEmailAndPassword(cloud.auth, String(email).trim(), password); return null; }
  catch (e) { return authError(e); }
};
cloud.signOut = () => window.CloudSDK.signOut(cloud.auth);
cloud.resetPassword = async email => {
  try { await window.CloudSDK.sendPasswordResetEmail(cloud.auth, String(email).trim()); return null; }
  catch (e) { return authError(e); }
};

// ============ Ortak kategoriler: veri erişimi ============
// Firestore belgeleri düz nesnelere çevrilir (zaman damgaları ms olarak); arayüz Firebase türlerini görmez.
// Veri modeli ve güvenlik kuralları: firebase/firestore.rules
const fsd = () => window.CloudSDK;
const tsMs = v => (v && typeof v.toMillis === 'function') ? v.toMillis() : null;
// Hata kodlarını anlaşılır Türkçeye çevirir (yoksa kodun kendisi gösterilir)
const CLOUD_ERRORS = {
  'permission-denied': 'bu işlem için yetkin yok (kategoriden çıkarılmış ya da hesabın pasife alınmış olabilir)',
  'unavailable': 'sunucuya ulaşılamıyor; değişiklikler bağlantı gelince gönderilecek',
  'resource-exhausted': 'günlük ücretsiz kota doldu; yarın düzelir',
  'unauthenticated': 'oturum süresi dolmuş; yeniden giriş yap',
};
const cloudErrorText = e => CLOUD_ERRORS[e?.code] || e?.code || e?.message || String(e);

// Kullanım sayacı (TAHMİN): sunucudan gelen belge ve yazma sayısı, günlük olarak cihazda tutulur ve yöneticiye bildirilir.
// Kurallardaki get/exists çağrıları da okuma sayıldığı için her yazma ≈ +2 okuma eklenir. Kesin rakam Firebase konsolundadır.
const usageToday = () => {
  const u = store.get('usage', null);
  return u && u.gun === todayISO() ? u : { gun: todayISO(), okuma: 0, yazma: 0, sent: 0 };
};
cloud.count = (reads, writes) => {
  const u = usageToday();
  u.okuma += reads + 2 * writes;
  u.yazma += writes;
  store.set('usage', u);
};
cloud.reportUsage = async () => {
  const user = cloud.user;
  if (!user?.active) return;
  const before = usageToday();
  if (before.sent === before.okuma + before.yazma) return;
  cloud.count(0, 1);
  const u = usageToday();
  u.sent = u.okuma + u.yazma;
  store.set('usage', u);
  await fsd().setDoc(fsd().doc(cloud.db, 'kullanim', user.uid), { eposta: user.email, gun: u.gun, okuma: u.okuma, yazma: u.yazma, guncelleme: cloud.now() });
};
const countSnap = snap => { if (!snap.metadata.fromCache) cloud.count(snap.docChanges().length, 0); };

const TASK_DAYS_DONE = 14;   // yapılmış görevlerden yalnızca son 14 günde tamamlananlar dinlenir (okuma kotası)

cloud.newId = () => fsd().doc(fsd().collection(cloud.db, 'categories')).id;
cloud.now = () => fsd().serverTimestamp();

// Üyesi olduğum kategoriler; cb([{ id, ad, sahip, uyeler, uyeAdlari }]) her değişimde çağrılır
cloud.watchCategories = (email, cb, onError) => {
  const q = fsd().query(fsd().collection(cloud.db, 'categories'), fsd().where('uyeler', 'array-contains', email));
  return fsd().onSnapshot(q, snap => countSnap(snap) || cb(snap.docs.map(d => {
    const x = d.data({ serverTimestamps: 'estimate' });
    return { id: d.id, ...x, olusturma: tsMs(x.olusturma), silinmeZamani: tsMs(x.silinmeZamani) };
  })), onError);
};

// Bir kategorinin görevleri: açık olanlar + son günlerde bitenler; cb([görev]) her iki sorgu da yanıtlayınca çağrılır.
// (Silinmiş görevler sorguya girmez; bitiş tarihi eski olanlar yüklenmez.)
cloud.watchTasks = (cid, cb, onError) => {
  const col = fsd().collection(cloud.db, 'categories', cid, 'tasks');
  const cutoff = fsd().Timestamp.fromMillis(Date.now() - TASK_DAYS_DONE * 864e5);
  const queries = [
    fsd().query(col, fsd().where('bitti', '==', false), fsd().where('silindi', '==', false)),
    fsd().query(col, fsd().where('bitirmeZamani', '>=', cutoff)),
  ];
  const res = [null, null];
  const emit = () => {
    if (!res[0] || !res[1]) return;
    const byId = new Map();
    for (const t of [...res[0], ...res[1]]) {
      const old = byId.get(t.id);
      if (!old || t.guncelleme >= old.guncelleme) byId.set(t.id, t);   // görev sorgular arasında geçerken yeni olan geçerli
    }
    cb([...byId.values()].filter(t => !t.silindi));
  };
  const unsubs = queries.map((q, i) => fsd().onSnapshot(q, snap => {
    countSnap(snap);
    res[i] = snap.docs.map(d => {
      const x = d.data({ serverTimestamps: 'estimate' });
      return { ...x, id: d.id, olusturma: tsMs(x.olusturma), bitirmeZamani: tsMs(x.bitirmeZamani), guncelleme: tsMs(x.guncelleme) };
    });
    emit();
  }, onError));
  return () => unsubs.forEach(u => u());
};

// Tamamlanan görev geçmişi (sayfalı): bitirme zamanına göre yeniden eskiye; ekrandaki listede olmayan eski görevleri de getirir
cloud.listDoneHistory = async (cid, after) => {
  const col = fsd().collection(cloud.db, 'categories', cid, 'tasks');
  const q = after ? fsd().query(col, fsd().orderBy('bitirmeZamani', 'desc'), fsd().startAfter(after), fsd().limit(50))
    : fsd().query(col, fsd().orderBy('bitirmeZamani', 'desc'), fsd().limit(50));
  const snap = await fsd().getDocs(q);
  cloud.count(snap.docs.length, 0);
  return { items: snap.docs.map(d => { const x = d.data(); return { ...x, id: d.id, bitirmeZamani: tsMs(x.bitirmeZamani) }; }), last: snap.docs[snap.docs.length - 1], more: snap.docs.length === 50 };
};

// Silinenler penceresi için: kategorinin yumuşak silinmiş görevleri (yalnızca istendiğinde okunur)
cloud.listDeletedTasks = async cid => {
  const snap = await fsd().getDocs(fsd().query(fsd().collection(cloud.db, 'categories', cid, 'tasks'), fsd().where('silindi', '==', true)));
  cloud.count(snap.docs.length, 0);
  return snap.docs.map(d => { const x = d.data(); return { id: d.id, metin: x.metin, silenKisi: x.silenKisi, guncelleme: tsMs(x.guncelleme) }; });
};

const taskRef = (cid, id) => fsd().doc(cloud.db, 'categories', cid, 'tasks', id);
cloud.createTask = (cid, id, data) =>
  (cloud.count(0, 1), fsd().setDoc(taskRef(cid, id), { ...data, olusturma: cloud.now(), guncelleme: cloud.now() }));
cloud.updateTask = (cid, id, patch) =>
  (cloud.count(0, 1), fsd().updateDoc(taskRef(cid, id), { ...patch, guncelleme: cloud.now() }));

cloud.createCategory = (id, ad, extra = {}) => (cloud.count(0, 1), fsd().setDoc(fsd().doc(cloud.db, 'categories', id), {
  ad, sahip: cloud.user.email, uyeler: [cloud.user.email], uyeAdlari: { [cloud.user.email]: cloud.user.ad || '' }, olusturma: cloud.now(), ...extra,
}));
// Toplu görev yazma (buluta taşıma): items = [{ id, data }]; her yazma grubu en fazla 400 işlem. Kategori belgesi önceden yazılmış olmalı (kurallar onu okur).
cloud.writeTasks = async (cid, items, onProgress) => {
  for (let i = 0; i < items.length; i += 400) {
    const batch = fsd().writeBatch(cloud.db);
    const now = cloud.now();
    items.slice(i, i + 400).forEach(({ id, data }) => batch.set(taskRef(cid, id), { ...data, olusturma: now, guncelleme: now }));
    await batch.commit();
    cloud.count(0, Math.min(400, items.length - i));
    onProgress?.(Math.min(i + 400, items.length));
  }
};
// Sunucudaki görev sayısı (doğrulama): silinmişler dahil bütün belgeler
cloud.countTasks = async cid => {
  const snap = await fsd().getCountFromServer(fsd().collection(cloud.db, 'categories', cid, 'tasks'));
  cloud.count(1, 0);
  return snap.data().count;
};
// Toplu sayaç ekleme (taşıma): agg = { g: {gün: n}, s: {gün: dk}, sn: {gün: n}, k: {kategori: n} }; anahtarlar statDay biçiminde
cloud.statsMerge = agg => {
  const inc = fsd().increment, out = {};
  for (const key of ['g', 's', 'sn', 'k']) {
    out[key] = {};
    for (const [k, v] of Object.entries(agg[key] || {})) { out[key][k] = inc(v); cloud.stats[key][k] = (cloud.stats[key][k] || 0) + v; }
  }
  cloud.count(0, 1);
  return fsd().setDoc(statsRef(), out, { merge: true });
};
// Kategori alanlarını günceller (ad, simge, silindi...): yalnızca sahip; kurallar doğrular
cloud.updateCategory = (cid, patch) => (cloud.count(0, 1), fsd().updateDoc(fsd().doc(cloud.db, 'categories', cid), patch));
// Kişiye özel kategori sırası: users/{uid}/tercihler/kategori { sira: [cid…] }
const orderRef = () => fsd().doc(cloud.db, 'users', cloud.user.uid, 'tercihler', 'kategori');
cloud.watchCatOrder = (cb, onError) => fsd().onSnapshot(orderRef(), snap => { countSnap(snap); cb(snap.exists() ? snap.data().sira || [] : []); }, onError);
cloud.setCatOrder = ids => (cloud.count(0, 1), fsd().setDoc(orderRef(), { sira: ids, guncelleme: cloud.now() }));
cloud.stampTs = stamp => fsd().Timestamp.fromDate(new Date(stamp));

// Tamamlama sayaçları (kişiye özel; tek belge): g = gün → bitirilen görev sayısı, s = gün → bitirme süresi toplamı (dakika),
// sn = gün → süresi bilinen görev sayısı, k = kategori → toplam bitirilen. Anahtarlar "d20261102" biçimindedir.
// Yalnızca benim tamamladıklarım sayılır; geri alınan görev için sayı düşürülür.
cloud.stats = { g: {}, s: {}, sn: {}, k: {} };
const statsRef = () => fsd().doc(cloud.db, 'users', cloud.user.uid, 'istatistik', 'ozet');
cloud.statDay = iso => 'd' + iso.replace(/-/g, '');
cloud.loadStats = async () => {
  const snap = await fsd().getDoc(statsRef());
  cloud.count(1, 0);
  const d = snap.exists() ? snap.data() : {};
  cloud.stats = { g: d.g || {}, s: d.s || {}, sn: d.sn || {}, k: d.k || {} };
};
cloud.statsAdd = (cid, dayIso, n, mins, durN) => {
  const k = cloud.statDay(dayIso), st = cloud.stats, add = (o, key, v) => { o[key] = (o[key] || 0) + v; };
  add(st.g, k, n); add(st.s, k, mins); add(st.sn, k, durN); add(st.k, cid, n);   // ekran hemen güncel kalsın
  const inc = fsd().increment;
  cloud.count(0, 1);
  return fsd().setDoc(statsRef(), { g: { [k]: inc(n) }, s: { [k]: inc(mins) }, sn: { [k]: inc(durN) }, k: { [cid]: inc(n) } }, { merge: true });
};
cloud.setMembers = (cid, uyeler, uyeAdlari) => (cloud.count(0, 1), fsd().updateDoc(fsd().doc(cloud.db, 'categories', cid), { uyeler, uyeAdlari }));

// Üyeyi çıkarır (sahip biri için ya da kişi kendi isteğiyle ayrılırken). Kurallar üye olmayan birini görevde kabul etmez;
// bu yüzden önce o kişinin atamaları ve "bitiren" izi görevlerden temizlenir (kişi hâlâ üyeyken), sonra listeden çıkarılır.
cloud.removeMember = async (cid, email, uyeler, uyeAdlari) => {
  const col = fsd().collection(cloud.db, 'categories', cid, 'tasks');
  for (const field of ['atanan', 'bitiren', 'atananlar']) {
    const list = field === 'atananlar';
    const snap = await fsd().getDocs(fsd().query(col, fsd().where(field, list ? 'array-contains' : '==', email)));
    cloud.count(snap.docs.length, snap.docs.length);
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = fsd().writeBatch(cloud.db);
      snap.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { [field]: list ? fsd().arrayRemove(email) : null, guncelleme: cloud.now() }));
      await batch.commit();
    }
  }
  await cloud.setMembers(cid, uyeler, uyeAdlari);
};

// ============ Yönetici (admins/{uid} belgesi olan hesap; kurallar başkasına izin vermez) ============
const adminList = async name => {
  const snap = await fsd().getDocs(fsd().collection(cloud.db, name));
  cloud.count(snap.docs.length, 0);
  return snap.docs.map(d => { const x = d.data({ serverTimestamps: 'estimate' }); return { ...x, id: d.id, zaman: tsMs(x.zaman), guncelleme: tsMs(x.guncelleme) }; });
};
cloud.admin = {
  setSparkConfig: c => (cloud.count(0, 1), fsd().setDoc(fsd().doc(cloud.db, 'ayarlar', 'spark'), { geminiModel: c.geminiModel, yedekModeller: c.yedekModeller, sesModelleri: c.sesModelleri, guncelleme: cloud.now() })
    .then(() => { cloud.sparkConfig = c; return applySparkConfig(); })),
  listAllowed: () => adminList('allowed'),
  listRequests: () => adminList('istekler'),
  listUsage: () => adminList('kullanim'),
  setAllowed: (uid, data) => (cloud.count(0, 1), fsd().setDoc(fsd().doc(cloud.db, 'allowed', uid), data)),
  deleteAllowed: uid => (cloud.count(0, 1), fsd().deleteDoc(fsd().doc(cloud.db, 'allowed', uid))),
  deleteRequest: uid => (cloud.count(0, 1), fsd().deleteDoc(fsd().doc(cloud.db, 'istekler', uid))),
};
