// ============ Geçmiş: tamamlanan görevler (tüm zamanlar) ============
// Ekrandaki listede yalnızca açık görevler ve son günlerde bitenler vardır; eski tamamlananlar bulutta durur ve burada sayfa sayfa (50'şer) okunur.
// Kategoriler sekme olarak seçilir; yüklenenler içinde aranır; görevler tamamlanma ayına göre gruplanır.
let histCat = null, histCursor = null, histRows = [];
const fmtHistMonth = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const fmtHistDay = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
async function loadHistory(more) {
  const cat = cloudCats().find(c => c.cid === histCat);
  if (!cat) return;
  const msg = $('#histMsg');
  msg.textContent = 'Yükleniyor…';
  try {
    const r = await cloud.listDoneHistory(cat.cid, more ? histCursor : null);
    histCursor = r.last;
    histRows = more ? [...histRows, ...r.items] : r.items;
    msg.textContent = '';
    $('#histMore').hidden = !r.more;
    renderHistory();
  } catch (e) { msg.textContent = `Okunamadı: ${cloudErrorText(e)}`; }
}
function renderHistory() {
  const cat = cloudCats().find(c => c.cid === histCat);
  const q = lower($('#histSearch').value.trim());
  const rows = histRows.filter(x => x.bitti && !x.silindi && (!q || lower(x.metin).includes(q)));
  let html = '', month = '';
  for (const x of rows) {
    const d = x.bitirmeZamani ? new Date(x.bitirmeZamani) : null;
    const m = d ? fmtHistMonth.format(d) : 'Tarihi bilinmeyen';
    if (m !== month) { month = m; html += `<h3 class="hist-month">${esc(m)}</h3>`; }
    html += `<div class="hist-row"><span class="hist-chk">${ico('check')}</span><span class="hist-txt">${renderInline(x.metin)}</span>
      <span class="hist-meta">${d ? esc(fmtHistDay.format(d)) : ''}${x.bitiren && cat?.shared ? ` · ${esc(memberName(cat, x.bitiren))}` : ''}</span></div>`;
  }
  $('#histList').innerHTML = html || `<p class="muted hist-empty">${q ? 'Eşleşen görev yok.' : 'Tamamlanmış görev yok.'}</p>`;
}
function drawHistTabs() {
  $('#histTabs').innerHTML = activeCats().map(c => `<button type="button" data-c="${esc(c.cid)}" class="${c.cid === histCat ? 'on' : ''}">${c.icon ? `<span class="cat-ico">${c.icon}</span>` : ''}${esc(c.name)}</button>`).join('');
}
$('#histTabs').onclick = e => {
  const b = e.target.closest('[data-c]');
  if (!b || b.dataset.c === histCat) return;
  histCat = b.dataset.c;
  histCursor = null;
  drawHistTabs();
  loadHistory(false);
};
$('#openHistory').onclick = () => {
  const cats = activeCats();
  if (!cats.length) return;
  histCat = cats.find(c => c.name === selectedCat)?.cid || cats[0].cid;
  $('#histSearch').value = '';
  drawHistTabs();
  $('#historyDlg').showModal();
  loadHistory(false);
};
$('#histSearch').oninput = renderHistory;
$('#histMore').onclick = () => loadHistory(true);
