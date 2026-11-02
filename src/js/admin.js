// ============ Yönetici sayfası (Ayarlar → Yönetici) ============
// Yalnızca admins/{uid} belgesi olan hesapta görünür; asıl koruma firebase/firestore.rules'tadır (başkası bu verilere yazamaz/okuyamaz).
// İzin listesi (allowed), bekleyen "beni ekle" istekleri (istekler) ve istemcilerin bildirdiği tahmini kullanım (kullanim).
const QUOTA = { okuma: 50000, yazma: 20000 };   // Firebase Spark planı günlük ücretsiz kotası

async function renderAdmin() {
  if (!cloud.user?.admin) return;
  const st = $('#admStatus');
  st.textContent = 'Yükleniyor…';
  try {
    const [allowed, requests, usage] = await Promise.all([cloud.admin.listAllowed(), cloud.admin.listRequests(), cloud.admin.listUsage()]);
    st.textContent = '';
    renderAdminRequests(requests.filter(r => !allowed.some(a => a.id === r.id)));
    renderAdminAllowed(allowed);
    renderAdminUsage(usage.filter(u => u.gun === todayISO()));
    renderSparkModels();
  } catch (e) { st.textContent = `Okunamadı: ${cloudErrorText(e)}`; }
}

function renderAdminRequests(rows) {
  const box = $('#admRequests');
  box.innerHTML = rows.length ? `<ul class="trash-list">${rows.map(r => `
    <li><span class="tl-main"><span class="tl-text">${esc(r.eposta)}</span>
      <span class="muted">${r.zaman ? esc(fmtStamp.format(new Date(r.zaman))) : ''}</span></span>
      <input class="adm-name" data-uid="${esc(r.id)}" placeholder="Görünecek ad" value="${esc(r.eposta.split('@')[0])}">
      <button type="button" data-ok="${esc(r.id)}">Onayla</button>
      <button type="button" data-no="${esc(r.id)}">Reddet</button></li>`).join('')}</ul>` : '<p class="muted">Bekleyen istek yok.</p>';
  box.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
    const r = rows.find(x => x.id === b.dataset.ok);
    const ad = box.querySelector(`.adm-name[data-uid="${CSS.escape(r.id)}"]`).value.trim().slice(0, 60);
    await adminDo(async () => {
      await cloud.admin.setAllowed(r.id, { eposta: r.eposta.toLowerCase(), ad, aktif: true });
      await cloud.admin.deleteRequest(r.id);
    });
  });
  box.querySelectorAll('[data-no]').forEach(b => b.onclick = () => adminDo(() => cloud.admin.deleteRequest(b.dataset.no)));
}

function renderAdminAllowed(rows) {
  const box = $('#admAllowed');
  rows.sort((a, b) => a.eposta.localeCompare(b.eposta));
  box.innerHTML = rows.length ? `<ul class="trash-list">${rows.map(r => {
    const me = r.id === cloud.user.uid;
    return `<li><span class="tl-main"><input class="adm-name" data-uid="${esc(r.id)}" value="${esc(r.ad || '')}" placeholder="Görünecek ad">
        <span class="muted">${esc(r.eposta)}${me ? ' · sen' : ''}</span></span>
      <label class="check"><input type="checkbox" data-act="${esc(r.id)}" ${r.aktif ? 'checked' : ''} ${me ? 'disabled' : ''}> Aktif</label>
      <button type="button" data-reset="${esc(r.eposta)}" title="Şifre sıfırlama e-postası gönder">Şifre</button>
      ${me ? '' : `<button type="button" data-del="${esc(r.id)}" title="İzin listesinden çıkar (Firebase hesabı konsolda kalır)">Çıkar</button>`}</li>`;
  }).join('')}</ul>` : '<p class="muted">Liste boş.</p>';
  const find = id => rows.find(r => r.id === id);
  box.querySelectorAll('input.adm-name').forEach(i => i.onchange = () => {
    const r = find(i.dataset.uid);
    adminDo(() => cloud.admin.setAllowed(r.id, { eposta: r.eposta, ad: i.value.trim().slice(0, 60), aktif: r.aktif }));
  });
  box.querySelectorAll('[data-act]').forEach(c => c.onchange = () => {
    const r = find(c.dataset.act);
    adminDo(() => cloud.admin.setAllowed(r.id, { eposta: r.eposta, ad: r.ad || '', aktif: c.checked }));
  });
  box.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const err = await cloud.resetPassword(b.dataset.reset);
    $('#admStatus').textContent = err || `${b.dataset.reset} adresine şifre sıfırlama e-postası gönderildi.`;
  });
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const r = find(b.dataset.del);
    if (!confirm(`${r.eposta} izin listesinden çıkarılsın mı?\n\nHesap Firebase'de durur ama hiçbir ortak veriyi göremez.`)) return;
    adminDo(() => cloud.admin.deleteAllowed(r.id));
  });
}

function renderAdminUsage(rows) {
  const sum = k => rows.reduce((n, r) => n + (r[k] || 0), 0);
  const bar = (label, n, max) => {
    const pct = Math.round((n / max) * 100);
    return `<div class="adm-use"><span>${label}: <b>${n.toLocaleString('tr-TR')}</b> / ${max.toLocaleString('tr-TR')} (%${pct})</span>
      <div class="st-prog"><i style="width:${Math.min(100, pct)}%;${pct >= 80 ? 'background:var(--load-3)' : ''}"></i></div></div>`;
  };
  $('#admUsage').innerHTML = (rows.length ? bar('Okuma', sum('okuma'), QUOTA.okuma) + bar('Yazma', sum('yazma'), QUOTA.yazma) : '<p class="muted">Bugün için henüz bildirim yok (istemciler yarım saatte bir bildirir).</p>')
    + (sum('okuma') >= QUOTA.okuma * 0.8 || sum('yazma') >= QUOTA.yazma * 0.8 ? '<p class="mem-msg">Günlük ücretsiz kotanın %80\'ine yaklaşıldı.</p>' : '')
    + (rows.length ? `<ul class="trash-list">${rows.sort((a, b) => b.okuma - a.okuma).map(r => `<li><span class="tl-main"><span class="tl-text">${esc(r.eposta)}</span>
        <span class="muted">${r.okuma.toLocaleString('tr-TR')} okuma · ${r.yazma.toLocaleString('tr-TR')} yazma</span></span></li>`).join('')}</ul>` : '');
}

// Yönetici işlemi: hatayı göster, sonra sayfayı yenile
async function adminDo(fn) {
  try { await fn(); } catch (e) { $('#admStatus').textContent = `Olmadı: ${cloudErrorText(e)}`; return; }
  renderAdmin();
}
$('#admRefresh').onclick = renderAdmin;

// ---- Spark modelleri (herkes için merkezden): ayarlar/spark belgesi; değişiklik anında kaydedilir ve bu uygulamaya da uygulanır ----
let admSpark = { geminiModel: '', yedekModeller: [], sesModelleri: [] };
function renderSparkModels() {
  admSpark = cloud.sparkConfig ? { ...cloud.sparkConfig } : {
    geminiModel: settings.geminiModel || '',
    yedekModeller: String(settings.geminiFallbackModels || '').split(',').map(x => x.trim()).filter(Boolean),
    sesModelleri: String(settings.ttsModels || '').split(',').map(x => x.trim()).filter(Boolean),
  };
  $('#admGeminiModel').value = admSpark.geminiModel;
  drawModelList('#admFallbackList', 'yedekModeller', 'Yedek model yok — ana model hata verirse işlem başarısız olur.');
  drawModelList('#admTtsList', 'sesModelleri', 'Model yok — Spark Windows sesiyle konuşur.');
}
async function saveSparkModels() {
  $('#admSparkMsg').textContent = 'Kaydediliyor…';
  try {
    await cloud.admin.setSparkConfig({ geminiModel: admSpark.geminiModel.trim(), yedekModeller: admSpark.yedekModeller, sesModelleri: admSpark.sesModelleri });
    $('#admSparkMsg').textContent = 'Kaydedildi ✓ Kullanıcılara bir sonraki girişlerinde uygulanır.';
  } catch (e) { $('#admSparkMsg').textContent = `Olmadı: ${cloudErrorText(e)}`; }
}
function drawModelList(sel, key, empty) {
  const items = admSpark[key];
  $(sel).innerHTML = items.length
    ? items.map((m, i) => `<li><span>${esc(m)}</span><span class="ml-act"><button type="button" class="icon-btn" data-up="${i}" title="Yukarı" ${i ? '' : 'disabled'}>▲</button><button type="button" class="icon-btn" data-dn="${i}" title="Aşağı" ${i < items.length - 1 ? '' : 'disabled'}>▼</button><button type="button" class="icon-btn" data-rm="${i}" title="Listeden çıkar">✕</button></span></li>`).join('')
    : `<li class="muted">${empty}</li>`;
  $(sel).onclick = e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const arr = admSpark[key], d = b.dataset;
    if (d.rm != null) arr.splice(+d.rm, 1);
    else if (d.up != null) [arr[+d.up - 1], arr[+d.up]] = [arr[+d.up], arr[+d.up - 1]];
    else if (d.dn != null) [arr[+d.dn + 1], arr[+d.dn]] = [arr[+d.dn], arr[+d.dn + 1]];
    else return;
    drawModelList(sel, key, empty);
    saveSparkModels();
  };
}
function bindModelAdd(input, btn, key, sel, empty) {
  const add = () => {
    const v = $(input).value.trim();
    if (!v) return;
    $(input).value = '';
    if (!admSpark[key].includes(v)) { admSpark[key].push(v); drawModelList(sel, key, empty); saveSparkModels(); }
  };
  $(btn).onclick = add;
  $(input).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
}
bindModelAdd('#admFallbackAdd', '#admFallbackAddBtn', 'yedekModeller', '#admFallbackList', 'Yedek model yok — ana model hata verirse işlem başarısız olur.');
bindModelAdd('#admTtsAdd', '#admTtsAddBtn', 'sesModelleri', '#admTtsList', 'Model yok — Spark Windows sesiyle konuşur.');
$('#admGeminiModel').addEventListener('change', e => { admSpark.geminiModel = e.target.value.trim(); if (admSpark.geminiModel) saveSparkModels(); });
