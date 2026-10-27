// ============ Silinenler ============
// Pasif yapılmış görevleri, kategorileri ve notları listeler; tek tıkla geri getirir.
// (Dosyadan elle <!-- silindi: … --> işaretini silmek de aynı şekilde çalışmaya devam eder.)
const deletedAtOf = s => fmtStampStr(((s.match(DEL_AT_RE) || [])[1] || '').replace(' ', 'T'));

async function renderTrash() {
  await loadTodos();   // dosyadaki en güncel durumla çalış
  const body = $('#trashBody');
  const deletedNotes = await api.notes.listDeleted();

  const taskRows = [];
  for (const cat of activeCats()) {
    cat.hidden.forEach((line, i) => {
      const t = parseTaskLine(line.replace(DEL_RE, ''));
      if (t) taskRows.push({ cat, i, t, at: deletedAtOf(line) });
    });
  }
  for (const r of await deletedSharedTasks()) {
    taskRows.push({ cat: r.cat, id: r.id, t: { text: r.text }, at: `${fmtStamp.format(new Date(r.at || Date.now()))}${r.by ? ' · ' + r.by : ''}` });
  }
  const catRows = todo.cats.filter(c => c.deleted);

  const section = (title, rows) => `<h3>${title} <span class="muted">(${rows.length})</span></h3>`
    + (rows.length ? `<ul class="trash-list">${rows.join('')}</ul>` : '<p class="muted">Yok</p>');
  body.innerHTML =
    section('Görevler', taskRows.map((r, k) => `
      <li><span class="tl-main"><span class="tl-text">${renderInline(r.t.text)}</span>
        <span class="muted">${esc(r.cat.name)}${r.id ? ' (ortak)' : ''} · ${esc(r.at)}</span></span>
        <button type="button" data-task="${k}">Geri getir</button></li>`)) +
    section('Kategoriler', catRows.map((c, k) => `
      <li><span class="tl-main"><span class="tl-text">${esc(c.name)}</span>
        <span class="muted">${c.tasks.length} görev · ${esc(fmtStampStr((c.mark.match(DEL_AT_RE) || [])[1]?.replace(' ', 'T') || ''))}</span></span>
        <button type="button" data-cat="${k}">Geri getir</button></li>`)) +
    section('Notlar', deletedNotes.map((n, k) => `
      <li><span class="tl-main"><span class="tl-text">${esc(n.name)}</span>
        <span class="muted">${esc(fmtStampStr(n.deletedAt.replace(' ', 'T')))}</span></span>
        <button type="button" data-note="${k}">Geri getir</button></li>`));

  body.querySelectorAll('[data-task]').forEach(b => b.onclick = async () => {
    const r = taskRows[+b.dataset.task];
    if (r.id) restoreSharedTask(r); else { restoreHiddenTask(r.cat, r.i); await saveTodos(); }
    renderTrash();
  });
  body.querySelectorAll('[data-cat]').forEach(b => b.onclick = async () => {
    restoreCategory(catRows[+b.dataset.cat]);
    await saveTodos();
    renderTrash();
  });
  body.querySelectorAll('[data-note]').forEach(b => b.onclick = async () => {
    await api.notes.restore(deletedNotes[+b.dataset.note].name);
    await loadNoteList();
    renderTrash();
  });
}

$('#openTrash').onclick = async () => {
  await renderTrash();
  $('#trashDlg').showModal();
};
