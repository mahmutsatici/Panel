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
    if (!u) return;
    // İzin listesindeki kaydım: aktifse ortak kategoriler açılır
    try {
      const snap = await sdk.getDoc(sdk.doc(cloud.db, 'allowed', u.uid));
      if (cloud.user?.uid !== u.uid) return;
      const d = snap.exists() ? snap.data() : null;
      cloud.user.active = !!(d && d.aktif === true);
      cloud.user.ad = d?.ad || '';
    } catch (e) { cloud.user.error = e.code || e.message; }
    cloudChanged();
  });
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
const TASK_DAYS_DONE = 14;   // yapılmış görevlerden yalnızca son 14 günde tamamlananlar dinlenir (okuma kotası)

cloud.newId = () => fsd().doc(fsd().collection(cloud.db, 'categories')).id;
cloud.now = () => fsd().serverTimestamp();

// Üyesi olduğum kategoriler; cb([{ id, ad, sahip, uyeler, uyeAdlari }]) her değişimde çağrılır
cloud.watchCategories = (email, cb, onError) => {
  const q = fsd().query(fsd().collection(cloud.db, 'categories'), fsd().where('uyeler', 'array-contains', email));
  return fsd().onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))), onError);
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
  return snap.docs.map(d => { const x = d.data(); return { id: d.id, metin: x.metin, silenKisi: x.silenKisi, guncelleme: tsMs(x.guncelleme) }; });
};

const taskRef = (cid, id) => fsd().doc(cloud.db, 'categories', cid, 'tasks', id);
cloud.createTask = (cid, id, data) =>
  fsd().setDoc(taskRef(cid, id), { ...data, olusturma: cloud.now(), guncelleme: cloud.now() });
cloud.updateTask = (cid, id, patch) =>
  fsd().updateDoc(taskRef(cid, id), { ...patch, guncelleme: cloud.now() });

cloud.createCategory = (id, ad) => fsd().setDoc(fsd().doc(cloud.db, 'categories', id), {
  ad, sahip: cloud.user.email, uyeler: [cloud.user.email], uyeAdlari: { [cloud.user.email]: cloud.user.ad || '' }, olusturma: cloud.now(),
});
cloud.setMembers = (cid, uyeler, uyeAdlari) => fsd().updateDoc(fsd().doc(cloud.db, 'categories', cid), { uyeler, uyeAdlari });

// Üyeyi çıkarır (sahip biri için ya da kişi kendi isteğiyle ayrılırken). Kurallar üye olmayan birini görevde kabul etmez;
// bu yüzden önce o kişinin atamaları ve "bitiren" izi görevlerden temizlenir (kişi hâlâ üyeyken), sonra listeden çıkarılır.
cloud.removeMember = async (cid, email, uyeler, uyeAdlari) => {
  const col = fsd().collection(cloud.db, 'categories', cid, 'tasks');
  for (const field of ['atanan', 'bitiren']) {
    const snap = await fsd().getDocs(fsd().query(col, fsd().where(field, '==', email)));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = fsd().writeBatch(cloud.db);
      snap.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { [field]: null, guncelleme: cloud.now() }));
      await batch.commit();
    }
  }
  await cloud.setMembers(cid, uyeler, uyeAdlari);
};
cloud.renameCategory = (cid, ad) => fsd().updateDoc(fsd().doc(cloud.db, 'categories', cid), { ad });

// Kategoriyi siler: önce görevleri (kurallar görev silmeyi kategori belgesi varken izin verir), sonra kategoriyi
cloud.deleteCategory = async cid => {
  const snap = await fsd().getDocs(fsd().collection(cloud.db, 'categories', cid, 'tasks'));
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = fsd().writeBatch(cloud.db);
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  const batch = fsd().writeBatch(cloud.db);
  batch.delete(fsd().doc(cloud.db, 'categories', cid));
  await batch.commit();
};
