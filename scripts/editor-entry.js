// Toast UI Editor'ü (ProseMirror dahil) tek bir tarayıcı dosyasına paketlemek için giriş noktası.
import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/i18n/tr-tr';
import { lift } from 'prosemirror-commands';
import { TextSelection } from 'prosemirror-state';

window.ToastEditor = Editor;
// Araç çubuğu düğmelerinin "ikinci tıkta geri al" davranışı için (editörle aynı ProseMirror kopyası)
window.PM = { lift, TextSelection };
