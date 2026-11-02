// ============ Geçmiş: tamamlanan görevler (tüm zamanlar) ============
// Ekrandaki listede yalnızca açık görevler ve son günlerde bitenler vardır; eski tamamlananlar bulutta durur ve burada sayfa sayfa (50'şer) okunur.
let histCat = null, histCursor = null, histRows = [];
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
  const rows = histRows.filter(x => x.bitti && !x.silindi);
  $('#histList').innerHTML = rows.length
    ? rows.map(x => `<li><span class="tl-main"><span class="tl-text">${renderInline(x.metin)}</span>
        <span class="muted">${x.bitirmeZamani ? esc(fmtStamp.format(new Date(x.bitirmeZamani))) : ''}${x.bitiren && cat ? ' · ' + esc(memberName(cat, x.bitiren)) : ''}</span></span></li>`).join('')
    : '<li class="muted">Tamamlanmış görev yok.</li>';
}
$('#openHistory').onclick = () => {
  const cats = activeCats();
  if (!cats.length) return;
  $('#histCat').innerHTML = cats.map(c => `<option value="${esc(c.cid)}">${esc(c.name)}</option>`).join('');
  histCat = cats.find(c => c.name === selectedCat)?.cid || cats[0].cid;
  $('#histCat').value = histCat;
  $('#histCat').dispatchEvent(new Event('change'));   // özel liste etiketi tazelensin
  $('#historyDlg').showModal();
  loadHistory(false);
};
$('#histCat').onchange = e => { histCat = e.target.value; histCursor = null; if ($('#historyDlg').open) loadHistory(false); };
$('#histMore').onclick = () => loadHistory(true);
