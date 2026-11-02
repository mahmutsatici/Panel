// ============ Silinenler ============
// Silinmiş görevleri, kategorileri ve notları listeler; tek tıkla geri getirir.
// (Görevler ve kategoriler bulutta "silindi" işaretlidir; hiçbir şey kalıcı silinmez.)
async function renderTrash() {
  const body = $('#trashBody');
  const deletedNotes = await api.notes.listDeleted();

  const taskRows = (await deletedSharedTasks()).map(r => ({ cat: r.cat, id: r.id, t: { text: r.text }, at: `${fmtStamp.format(new Date(r.at || Date.now()))}${r.by ? ' · ' + r.by : ''}` }));
  const catRows = todo.cats.filter(c => c.deleted && isOwner(c));

  const section = (title, rows) => `<h3>${title} <span class="muted">(${rows.length})</span></h3>`
    + (rows.length ? `<ul class="trash-list">${rows.join('')}</ul>` : '<p class="muted">Yok</p>');
  body.innerHTML =
    section('Görevler', taskRows.map((r, k) => `
      <li><span class="tl-main"><span class="tl-text">${renderInline(r.t.text)}</span>
        <span class="muted">${esc(r.cat.name)} · ${esc(r.at)}</span></span>
        <button type="button" data-task="${k}">Geri getir</button></li>`)) +
    section('Kategoriler', catRows.map((c, k) => `
      <li><span class="tl-main"><span class="tl-text">${esc(c.name)}</span>
        <span class="muted">${c.silinme ? esc(fmtStamp.format(new Date(c.silinme))) : ''}</span></span>
        <button type="button" data-cat="${k}">Geri getir</button></li>`)) +
    section('Notlar', deletedNotes.map((n, k) => `
      <li><span class="tl-main"><span class="tl-text">${esc(n.name)}</span>
        <span class="muted">${esc(fmtStampStr(n.deletedAt.replace(' ', 'T')))}</span></span>
        <button type="button" data-note="${k}">Geri getir</button></li>`));

  body.querySelectorAll('[data-task]').forEach(b => b.onclick = async () => {
    restoreSharedTask(taskRows[+b.dataset.task]);
    setTimeout(renderTrash, 600);   // bulut yanıtı gelince liste tazelenir
  });
  body.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    restoreCloudCategory(catRows[+b.dataset.cat]);
    setTimeout(renderTrash, 600);
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
