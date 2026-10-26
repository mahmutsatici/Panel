// ============ Bulut hesabı (isteğe bağlı) ============
// Giriş yapılmazsa uygulama bugünkü gibi tamamen yerel çalışır. Giriş, ortak kategoriler içindir.
// Firebase'e yalnızca bu dosya dokunur (vendor/cloud.js → window.CloudSDK); ileride başka bir arka uca geçilirse
// değişecek tek yer burasıdır.
const cloud = {
  enabled: false,    // yapılandırma var mı (cloud-config.js ya da emülatör)
  ready: false,      // oturum durumu ilk kez öğrenildi mi
  user: null,        // { uid, email } ya da null
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
  cloud.enabled = true;
  sdk.onAuthStateChanged(cloud.auth, u => {
    cloud.user = u ? { uid: u.uid, email: String(u.email || '').toLowerCase() } : null;
    cloud.ready = true;
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
