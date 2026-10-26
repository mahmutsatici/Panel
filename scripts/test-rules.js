// Firestore güvenlik kuralı testlerini Firebase emülatörüyle çalıştırır (npm run test:rules).
// Emülatör Java ister: sistemde yoksa %LOCALAPPDATA%\panel-dev-tools altındaki taşınabilir JDK kullanılır
// (yönetici izni gerekmez; yalnızca testler içindir, uygulamayla ilgisi yoktur).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const env = { ...process.env };
const tools = path.join(process.env.LOCALAPPDATA || '', 'panel-dev-tools');
const jdk = fs.existsSync(tools) && fs.readdirSync(tools).find(n => /^jdk-21/.test(n));
if (jdk) {
  env.JAVA_HOME = path.join(tools, jdk);
  env.PATH = path.join(env.JAVA_HOME, 'bin') + path.delimiter + env.PATH;
}
const check = spawnSync('java', ['-version'], { env, stdio: 'ignore', shell: true });
if (check.status !== 0) {
  console.error('Java (JDK 21) bulunamadı. Taşınabilir JDK\'yı şuraya aç: ' + tools + '\\jdk-21…  (Microsoft OpenJDK 21 zip)');
  process.exit(1);
}
const r = spawnSync('npx', ['--yes', 'firebase-tools@15', 'emulators:exec', '--config', 'firebase/firebase.json',
  '--project', 'demo-panel', '--only', 'firestore', '"node --test firebase/tests/rules.test.mjs"'],
{ env, stdio: 'inherit', shell: true, cwd: path.join(__dirname, '..') });
process.exit(r.status ?? 1);
