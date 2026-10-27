// Firestore güvenlik kuralı testleri (Firebase emülatörü gerekir): npm run test:rules
// Her test "kim, neyi yapabilir / yapamaz" sorusunu doğrular. Kural değişince bu dosya da güncellenir.
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach, describe } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');   // reddedilen yazmalar beklenen davranış; SDK uyarılarıyla çıktıyı kirletme

let env;
const ALI = { uid: 'uid-ali', email: 'ali@x.com' };      // kategori sahibi
const VELI = { uid: 'uid-veli', email: 'veli@x.com' };   // üye
const CAN = { uid: 'uid-can', email: 'can@x.com' };      // izinli ama üye değil
const PASIF = { uid: 'uid-pasif', email: 'pasif@x.com' }; // izin listesinde ama aktif değil
const YABANCI = { uid: 'uid-yabanci', email: 'ali@x.com' }; // ALİ'nin e-postasıyla hesap açmış ama izin listesinde DEĞİL
const ADMIN = { uid: 'uid-admin', email: 'admin@x.com' };

const db = u => env.authenticatedContext(u.uid, { email: u.email }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const task = (over = {}) => ({
  metin: 'rapor yaz', bitti: false, son: null, tekrar: null, olusturan: ALI.email, atanan: null,
  olusturma: serverTimestamp(), bitirmeZamani: null, bitiren: null, silindi: false, silenKisi: null,
  guncelleme: serverTimestamp(), ...over,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-panel',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    for (const [u, aktif] of [[ALI, true], [VELI, true], [CAN, true], [PASIF, false]]) {
      await setDoc(doc(f, 'allowed', u.uid), { eposta: u.email, aktif });
    }
    await setDoc(doc(f, 'admins', ADMIN.uid), { eposta: ADMIN.email });
    await setDoc(doc(f, 'categories', 'k1'), {
      ad: 'Proje X', sahip: ALI.email, uyeler: [ALI.email, VELI.email], olusturma: new Date(),
    });
    await setDoc(doc(f, 'categories/k1/tasks', 't1'), {
      metin: 'ilk görev', bitti: false, son: null, tekrar: null, olusturan: ALI.email, atanan: VELI.email,
      olusturma: new Date(), bitirmeZamani: null, bitiren: null, silindi: false, silenKisi: null, guncelleme: new Date(),
    });
  });
});

describe('izin listesi ve giriş', () => {
  test('girişsiz kimse hiçbir şey okuyamaz', async () => {
    await assertFails(getDoc(doc(anon(), 'categories/k1')));
    await assertFails(getDocs(collection(anon(), 'categories/k1/tasks')));
  });
  test('izin listesinde olmayan hesap (ALİ\'nin e-postasıyla bile) kategori ve görev göremez', async () => {
    await assertFails(getDoc(doc(db(YABANCI), 'categories/k1')));
    await assertFails(getDoc(doc(db(YABANCI), 'categories/k1/tasks/t1')));
    await assertFails(getDocs(query(collection(db(YABANCI), 'categories'), where('uyeler', 'array-contains', ALI.email))));
  });
  test('pasif hesap hiçbir şey göremez', async () => {
    await assertFails(getDoc(doc(db(PASIF), 'categories/k1')));
  });
  test('yönetici olmayan hesap izin listesini yazamaz, listeleyemez; yönetici listesi hiç yazılamaz', async () => {
    await assertFails(setDoc(doc(db(ALI), 'allowed', 'uid-ali'), { eposta: ALI.email, ad: 'Ali', aktif: true }));
    await assertFails(setDoc(doc(db(CAN), 'allowed', 'uid-can'), { eposta: CAN.email, ad: 'Can', aktif: false }));
    await assertFails(deleteDoc(doc(db(ALI), 'allowed', 'uid-veli')));
    await assertFails(getDocs(collection(db(ALI), 'allowed')));
    await assertFails(setDoc(doc(db(ALI), 'admins', 'uid-ali'), { eposta: ALI.email }));
    await assertFails(setDoc(doc(db(ADMIN), 'admins', 'uid-ali'), { eposta: ALI.email }));   // yönetici bile admins'e yazamaz (yalnızca konsol)
    await assertSucceeds(getDoc(doc(db(ALI), 'allowed', 'uid-ali')));   // yalnızca kendi belgesini okur
    await assertFails(getDoc(doc(db(ALI), 'allowed', 'uid-veli')));
  });
  test('yönetici izin listesini listeler, ekler, değiştirir ve siler; geçersiz belge reddedilir', async () => {
    const f = db(ADMIN);
    await assertSucceeds(getDocs(collection(f, 'allowed')));
    await assertSucceeds(setDoc(doc(f, 'allowed', 'uid-yeni'), { eposta: 'yeni@x.com', ad: 'Yeni', aktif: true }));
    await assertSucceeds(updateDoc(doc(f, 'allowed', 'uid-yeni'), { aktif: false }));
    await assertFails(setDoc(doc(f, 'allowed', 'uid-x'), { eposta: 'x@x.com', ad: 'X', aktif: 'evet' }));
    await assertFails(setDoc(doc(f, 'allowed', 'uid-x'), { eposta: 'x@x.com', ad: 'X', aktif: true, rol: 'admin' }));
    await assertSucceeds(deleteDoc(doc(f, 'allowed', 'uid-yeni')));
    await assertSucceeds(getDoc(doc(f, 'allowed', 'uid-veli')));
  });
  test('"beni ekle" isteğini yalnızca kendi UID\'siyle ve kendi e-postasıyla yazabilir', async () => {
    const now = serverTimestamp();
    await assertSucceeds(setDoc(doc(db(YABANCI), 'istekler', YABANCI.uid), { eposta: YABANCI.email, zaman: serverTimestamp() }));
    await assertFails(setDoc(doc(db(YABANCI), 'istekler', 'uid-ali'), { eposta: YABANCI.email, zaman: now }));          // başkasının belgesi
    await assertFails(setDoc(doc(db(CAN), 'istekler', CAN.uid), { eposta: ALI.email, zaman: serverTimestamp() }));       // başkasının e-postası
    await assertFails(setDoc(doc(db(CAN), 'istekler', CAN.uid), { eposta: CAN.email, zaman: serverTimestamp(), x: 1 })); // fazla alan
    await assertFails(getDocs(collection(db(CAN), 'istekler')));
    await assertSucceeds(getDoc(doc(db(YABANCI), 'istekler', YABANCI.uid)));
    await assertFails(getDoc(doc(db(CAN), 'istekler', YABANCI.uid)));
  });
  test('yönetici istekleri listeler ve siler; başkası listeleyemez/silemez', async () => {
    await setDoc(doc(db(YABANCI), 'istekler', YABANCI.uid), { eposta: YABANCI.email, zaman: serverTimestamp() });
    await assertFails(deleteDoc(doc(db(YABANCI), 'istekler', YABANCI.uid)));
    await assertSucceeds(getDocs(collection(db(ADMIN), 'istekler')));
    await assertSucceeds(deleteDoc(doc(db(ADMIN), 'istekler', YABANCI.uid)));
  });
  test('kullanım sayacı: aktif hesap yalnızca kendi belgesine yazar; yönetici hepsini okur', async () => {
    const ok = { eposta: CAN.email, gun: '2026-10-27', okuma: 12, yazma: 3, guncelleme: serverTimestamp() };
    await assertSucceeds(setDoc(doc(db(CAN), 'kullanim', CAN.uid), ok));
    await assertFails(setDoc(doc(db(CAN), 'kullanim', ALI.uid), { ...ok, guncelleme: serverTimestamp() }));                // başkasının belgesi
    await assertFails(setDoc(doc(db(CAN), 'kullanim', CAN.uid), { ...ok, okuma: -1, guncelleme: serverTimestamp() }));
    await assertFails(setDoc(doc(db(CAN), 'kullanim', CAN.uid), { ...ok, gun: 'bugün', guncelleme: serverTimestamp() }));
    await assertFails(setDoc(doc(db(PASIF), 'kullanim', PASIF.uid), { ...ok, eposta: PASIF.email, guncelleme: serverTimestamp() }));  // pasif hesap yazamaz
    await assertFails(getDocs(collection(db(CAN), 'kullanim')));
    await assertSucceeds(getDocs(collection(db(ADMIN), 'kullanim')));
  });
});

describe('kategori', () => {
  test('izinli hesap kategori kurabilir; tek üye (kendisi) ve sahip kendisi olmalı', async () => {
    const f = db(CAN);
    await assertSucceeds(setDoc(doc(f, 'categories', 'yeni'), { ad: 'Ev', sahip: CAN.email, uyeler: [CAN.email], olusturma: serverTimestamp() }));
    await assertFails(setDoc(doc(f, 'categories', 'yeni2'), { ad: 'Ev', sahip: ALI.email, uyeler: [ALI.email], olusturma: serverTimestamp() }));
    await assertFails(setDoc(doc(f, 'categories', 'yeni3'), { ad: 'Ev', sahip: CAN.email, uyeler: [CAN.email, ALI.email], olusturma: serverTimestamp() }));
    await assertFails(setDoc(doc(f, 'categories', 'yeni4'), { ad: '', sahip: CAN.email, uyeler: [CAN.email], olusturma: serverTimestamp() }));
  });
  test('üye kendi kategorilerini sorguyla listeler; filtresiz listeleme yapılamaz', async () => {
    await assertSucceeds(getDocs(query(collection(db(VELI), 'categories'), where('uyeler', 'array-contains', VELI.email))));
    await assertFails(getDocs(collection(db(VELI), 'categories')));
    await assertFails(getDocs(query(collection(db(CAN), 'categories'), where('uyeler', 'array-contains', ALI.email))));
  });
  test('üye olmayan kategoriyi okuyamaz', async () => {
    await assertFails(getDoc(doc(db(CAN), 'categories/k1')));
    await assertSucceeds(getDoc(doc(db(VELI), 'categories/k1')));
  });
  test('sahip üye ekler ve çıkarır; üye başkasını ekleyemez/çıkaramaz', async () => {
    await assertSucceeds(updateDoc(doc(db(ALI), 'categories/k1'), { uyeler: [ALI.email, VELI.email, CAN.email] }));
    await assertFails(updateDoc(doc(db(VELI), 'categories/k1'), { uyeler: [ALI.email, VELI.email, CAN.email] }));   // kendi kendini davet etmek de dahil
    await assertFails(updateDoc(doc(db(VELI), 'categories/k1'), { uyeler: [VELI.email] }));                          // sahibi çıkaramaz
    await assertFails(updateDoc(doc(db(CAN), 'categories/k1'), { uyeler: [ALI.email, VELI.email, CAN.email] }));     // üye olmayan kendini ekleyemez
  });
  test('üye kendini çıkarabilir (ayrılma)', async () => {
    await assertSucceeds(updateDoc(doc(db(VELI), 'categories/k1'), { uyeler: [ALI.email] }));
  });
  test('sahip kendini çıkaramaz, sahipliği devredemez, adı yalnızca sahip değiştirir', async () => {
    await assertFails(updateDoc(doc(db(ALI), 'categories/k1'), { uyeler: [VELI.email] }));
    await assertFails(updateDoc(doc(db(ALI), 'categories/k1'), { sahip: VELI.email }));
    await assertSucceeds(updateDoc(doc(db(ALI), 'categories/k1'), { ad: 'Yeni Ad' }));
    await assertFails(updateDoc(doc(db(VELI), 'categories/k1'), { ad: 'Ele Geçirdim' }));
  });
  test('kategoriyi yalnızca sahip siler', async () => {
    await assertFails(deleteDoc(doc(db(VELI), 'categories/k1')));
    await assertFails(deleteDoc(doc(db(CAN), 'categories/k1')));
    await assertSucceeds(deleteDoc(doc(db(ALI), 'categories/k1')));
  });
});

describe('görev', () => {
  test('üyeler görevleri okur, üye olmayan okuyamaz', async () => {
    await assertSucceeds(getDocs(collection(db(VELI), 'categories/k1/tasks')));
    await assertSucceeds(getDoc(doc(db(ALI), 'categories/k1/tasks/t1')));
    await assertFails(getDocs(collection(db(CAN), 'categories/k1/tasks')));
  });
  test('üye görev ekler; üye olmayan ekleyemez', async () => {
    await assertSucceeds(setDoc(doc(db(VELI), 'categories/k1/tasks', 'yeni'), task({ olusturan: VELI.email })));
    await assertFails(setDoc(doc(db(CAN), 'categories/k1/tasks', 'yeni2'), task({ olusturan: CAN.email })));
  });
  test('görev başkası adına eklenemez, geçersiz alanlar reddedilir', async () => {
    const f = db(VELI);
    await assertFails(setDoc(doc(f, 'categories/k1/tasks', 'a'), task({ olusturan: ALI.email })));            // başkası adına
    await assertFails(setDoc(doc(f, 'categories/k1/tasks', 'b'), task({ olusturan: VELI.email, metin: '' })));
    await assertFails(setDoc(doc(f, 'categories/k1/tasks', 'c'), task({ olusturan: VELI.email, metin: 'x'.repeat(501) })));
    await assertFails(setDoc(doc(f, 'categories/k1/tasks', 'd'), task({ olusturan: VELI.email, son: '10.10.2026' })));
    await assertFails(setDoc(doc(f, 'categories/k1/tasks', 'e'), task({ olusturan: VELI.email, fazlaAlan: 1 })));
    await assertFails(setDoc(doc(f, 'categories/k1/tasks', 'f'), task({ olusturan: VELI.email, guncelleme: new Date(0) })));  // sahte zaman
    await assertSucceeds(setDoc(doc(f, 'categories/k1/tasks', 'g'), task({ olusturan: VELI.email, son: '2026-10-30', tekrar: 'her hafta' })));
  });
  test('atanan yalnızca kategorinin üyesi olabilir', async () => {
    const f = db(ALI);
    await assertSucceeds(setDoc(doc(f, 'categories/k1/tasks', 'a'), task({ atanan: VELI.email })));
    await assertFails(setDoc(doc(f, 'categories/k1/tasks', 'b'), task({ atanan: CAN.email })));
  });
  test('herhangi bir üye görevi günceller, tamamlar ve yumuşak siler; oluşturan/oluşturma değişmez', async () => {
    const t = doc(db(VELI), 'categories/k1/tasks/t1');
    await assertSucceeds(updateDoc(t, { bitti: true, bitiren: VELI.email, bitirmeZamani: serverTimestamp(), guncelleme: serverTimestamp() }));
    await assertSucceeds(updateDoc(t, { silindi: true, silenKisi: VELI.email, guncelleme: serverTimestamp() }));
    await assertFails(updateDoc(t, { olusturan: VELI.email, guncelleme: serverTimestamp() }));
    await assertFails(updateDoc(t, { olusturma: serverTimestamp(), guncelleme: serverTimestamp() }));
    await assertFails(updateDoc(doc(db(CAN), 'categories/k1/tasks/t1'), { bitti: true, bitiren: CAN.email, guncelleme: serverTimestamp() }));
  });
  test('bitmemiş görevde bitiren olamaz; bitiren üye olmalı', async () => {
    const t = doc(db(VELI), 'categories/k1/tasks/t1');
    await assertFails(updateDoc(t, { bitti: false, bitiren: VELI.email, guncelleme: serverTimestamp() }));
    await assertFails(updateDoc(t, { bitti: true, bitiren: CAN.email, guncelleme: serverTimestamp() }));
  });
  test('görev fiziksel silinemez (üye); yalnızca kategori sahibi temizleyebilir', async () => {
    await assertFails(deleteDoc(doc(db(VELI), 'categories/k1/tasks/t1')));
    await assertFails(deleteDoc(doc(db(CAN), 'categories/k1/tasks/t1')));
    await assertSucceeds(deleteDoc(doc(db(ALI), 'categories/k1/tasks/t1')));
  });
  test('üyelikten çıkarılan kişi görevlere erişimini hemen kaybeder', async () => {
    await assertSucceeds(updateDoc(doc(db(ALI), 'categories/k1'), { uyeler: [ALI.email] }));
    await assertFails(getDoc(doc(db(VELI), 'categories/k1/tasks/t1')));
    await assertFails(updateDoc(doc(db(VELI), 'categories/k1/tasks/t1'), { bitti: true, bitiren: ALI.email, guncelleme: serverTimestamp() }));
  });
});
