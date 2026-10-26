// Firebase web yapılandırması (gizli değildir; asıl koruma firebase/firestore.rules ve izin listesidir).
// null → bulut özellikleri devre dışı, uygulama bugünkü gibi tamamen yerel çalışır.
// Firebase projesi açıldığında konsoldaki "Web uygulaması" ayarlarından şu biçimde doldurulur:
//   const CLOUD_CONFIG = { apiKey: '…', authDomain: '….firebaseapp.com', projectId: '…', appId: '…' };
const CLOUD_CONFIG = null;
