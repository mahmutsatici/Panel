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
      setTimeout(() => cloud.reportUsage().catch(() => {}), 60 * 1000);
    } else {
      try {
        const ref = sdk.doc(cloud.db, 'istekler', u.uid);
        if (!(await sdk.getDoc(ref)).exists()) await sdk.setDoc(ref, { eposta: u.email, zaman: sdk.serverTimestamp() });
        u.requested = true;
      } catch { u.requested = false; }
    }
  } catch (e) { u.error = e.code || e.message; }
  cloudChanged();
};

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
  return fsd().onSnapshot(q, snap => countSnap(snap) || cb(snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))), onError);
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

cloud.createCategory = (id, ad) => (cloud.count(0, 1), fsd().setDoc(fsd().doc(cloud.db, 'categories', id), {
  ad, sahip: cloud.user.email, uyeler: [cloud.user.email], uyeAdlari: { [cloud.user.email]: cloud.user.ad || '' }, olusturma: cloud.now(),
}));
cloud.setMembers = (cid, uyeler, uyeAdlari) => (cloud.count(0, 1), fsd().updateDoc(fsd().doc(cloud.db, 'categories', cid), { uyeler, uyeAdlari }));

// Üyeyi çıkarır (sahip biri için ya da kişi kendi isteğiyle ayrılırken). Kurallar üye olmayan birini görevde kabul etmez;
// bu yüzden önce o kişinin atamaları ve "bitiren" izi görevlerden temizlenir (kişi hâlâ üyeyken), sonra listeden çıkarılır.
cloud.removeMember = async (cid, email, uyeler, uyeAdlari) => {
  const col = fsd().collection(cloud.db, 'categories', cid, 'tasks');
  for (const field of ['atanan', 'bitiren']) {
    const snap = await fsd().getDocs(fsd().query(col, fsd().where(field, '==', email)));
    cloud.count(snap.docs.length, snap.docs.length);
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = fsd().writeBatch(cloud.db);
      snap.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { [field]: null, guncelleme: cloud.now() }));
      await batch.commit();
    }
  }
  await cloud.setMembers(cid, uyeler, uyeAdlari);
};
cloud.renameCategory = (cid, ad) => (cloud.count(0, 1), fsd().updateDoc(fsd().doc(cloud.db, 'categories', cid), { ad }));

// Kategoriyi siler: önce görevleri (kurallar görev silmeyi kategori belgesi varken izin verir), sonra kategoriyi
cloud.deleteCategory = async cid => {
  const snap = await fsd().getDocs(fsd().collection(cloud.db, 'categories', cid, 'tasks'));
  cloud.count(snap.docs.length, snap.docs.length);
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = fsd().writeBatch(cloud.db);
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  const batch = fsd().writeBatch(cloud.db);
  batch.delete(fsd().doc(cloud.db, 'categories', cid));
  await batch.commit();
};

// ============ Yönetici (admins/{uid} belgesi olan hesap; kurallar başkasına izin vermez) ============
const adminList = async name => {
  const snap = await fsd().getDocs(fsd().collection(cloud.db, name));
  cloud.count(snap.docs.length, 0);
  return snap.docs.map(d => { const x = d.data({ serverTimestamps: 'estimate' }); return { ...x, id: d.id, zaman: tsMs(x.zaman), guncelleme: tsMs(x.guncelleme) }; });
};
cloud.admin = {
  listAllowed: () => adminList('allowed'),
  listRequests: () => adminList('istekler'),
  listUsage: () => adminList('kullanim'),
  setAllowed: (uid, data) => (cloud.count(0, 1), fsd().setDoc(fsd().doc(cloud.db, 'allowed', uid), data)),
  deleteAllowed: uid => (cloud.count(0, 1), fsd().deleteDoc(fsd().doc(cloud.db, 'allowed', uid))),
  deleteRequest: uid => (cloud.count(0, 1), fsd().deleteDoc(fsd().doc(cloud.db, 'istekler', uid))),
};
