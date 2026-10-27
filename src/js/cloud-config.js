// Firebase web yapılandırması. Bu değerler gizli değildir (her web uygulamasında istemciye gönderilir);
// asıl koruma firebase/firestore.rules ve izin listesidir (allowed/{uid}).
// null yapılırsa bulut özellikleri devre dışı kalır ve uygulama tamamen yerel çalışır.
// Başka bir Firebase projesi kullanmak (fork) için aşağıdaki değerleri kendi projenin ayarlarından değiştir.
const CLOUD_CONFIG = {
  apiKey: 'AIzaSyCmwBKKHe_eiZu7PVEzIrOOCkUWC5jSZ2U',
  authDomain: 'spark-pano.firebaseapp.com',
  projectId: 'spark-pano',
  appId: '1:211383111808:web:ab6ff70195a5c54f5d5665',
};
