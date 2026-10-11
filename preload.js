const { contextBridge, ipcRenderer } = require('electron');

const call = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('panel', {
  todos: {
    read: () => call('todos:read'),
    write: content => call('todos:write', content),
  },
  notes: {
    list: () => call('notes:list'),
    search: q => call('notes:search', q),
    read: name => call('notes:read', name),
    write: (name, content) => call('notes:write', name, content),
    create: base => call('notes:create', base),
    rename: (from, to) => call('notes:rename', from, to),
    remove: name => call('notes:delete', name),
    listDeleted: () => call('notes:listDeleted'),
    restore: name => call('notes:restore', name),
    saveImage: (bytes, mime) => call('notes:saveImage', bytes, mime),
  },
  settings: {
    get: () => call('settings:get'),
    set: patch => call('settings:set', patch),
  },
  notify: {
    config: patch => call('notify:config', patch),
    test: () => call('notify:test'),
  },
  backup: {
    config: patch => call('backup:config', patch),
    choose: () => call('backup:choose'),
    now: () => call('backup:now'),
    open: () => call('backup:open'),
  },
  assistant: {
    ask: (audioBytes, mimeType, contextText) => call('assistant:ask', audioBytes, mimeType, contextText),
    test: () => call('assistant:test'),
    // SPARK'ın sesi: { pcm, sampleRate, model } döner; kota/bağlantı sorununda hata fırlatır
    speak: (text, voice) => call('assistant:speak', text, voice),
    // Ctrl+Alt+V kısayolu pencere gizliyken de çalışır; ana süreç bu olayı gönderir.
    onTrigger: cb => ipcRenderer.on('assistant:trigger', () => cb()),
  },
  setTitleBar: (color, symbolColor) => call('app:titleBar', color, symbolColor),
  openDataDir: () => call('app:openDataDir'),
  openExternal: url => call('app:openExternal', url),
});
