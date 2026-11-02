// ============ Giriş kapısı ============
// Giriş zorunludur: oturum yoksa ya da hesap yönetici tarafından onaylanmamışsa uygulamanın önünde bu ekran durur.
// Hesaplar yönetici tarafından açılır (kayıt yok); ilk girişte "beni ekle" isteği kendiliğinden gider (cloud.js → loadProfile).
const gateEl = $('#loginGate');
function renderGate() {
  const u = cloud.user;
  const state = !cloud.started || (cloud.enabled && !cloud.ready) ? 'wait'
    : !cloud.enabled ? 'config' : !u ? 'form' : u.active ? 'ok' : u.error ? 'error' : 'pending';
  gateEl.hidden = state === 'ok';
  $('#gateForm').hidden = state !== 'form';
  $('#gateActions').hidden = !(state === 'pending' || state === 'error');
  const msg = $('#gateMsg');
  msg.classList.remove('err');
  msg.textContent = {
    wait: 'Oturum kontrol ediliyor…',
    config: 'Bulut bağlantısı yapılandırılmamış; Panel bu sürümde giriş gerektirir. Yöneticine başvur.',
    form: 'Devam etmek için giriş yap.',
    pending: u?.requested ? `${u.email} hesabın yönetici onayını bekliyor. Onaylanınca "Durumu yenile"ye bas.` : `${u?.email} bu uygulamaya henüz eklenmemiş; yöneticinden hesabını onaylamasını iste.`,
    error: `Hesap bilgisi okunamadı (${cloudErrorText({ code: u?.error })}). İnternet bağlantını kontrol edip tekrar dene.`,
    ok: '',
  }[state];
  if (state === 'form') $('#gateEmail').focus();
}
$('#gateForm').onsubmit = async e => {
  e.preventDefault();
  const msg = $('#gateMsg'), btn = $('#gateSignIn');
  btn.disabled = true;
  msg.classList.remove('err');
  msg.textContent = 'Giriş yapılıyor…';
  const err = await cloud.signIn($('#gateEmail').value, $('#gatePass').value);
  btn.disabled = false;
  $('#gatePass').value = '';
  if (err) { msg.textContent = err; msg.classList.add('err'); }
};
$('#gateReset').onclick = async () => {
  const email = $('#gateEmail').value.trim(), msg = $('#gateMsg');
  if (!email) { msg.textContent = 'Önce e-posta adresini yaz.'; msg.classList.add('err'); return; }
  const err = await cloud.resetPassword(email);
  msg.classList.toggle('err', !!err);
  msg.textContent = err || `${email} adresine şifre sıfırlama e-postası gönderildi.`;
};
$('#gateRefresh').onclick = () => cloud.loadProfile();
$('#gateSignOut').onclick = () => cloud.signOut();
cloud.onChange(renderGate);
renderGate();
