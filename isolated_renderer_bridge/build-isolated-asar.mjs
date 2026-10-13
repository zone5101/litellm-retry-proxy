/** Rebuild only a separately copied ASAR. Never pass an installed WindowsApps path as output. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [sourceAsar, outputAsar, asarModule] = process.argv.slice(2);
if (!sourceAsar || !outputAsar || !asarModule) {
  throw Error('Usage: node build-isolated-asar.mjs SOURCE_APP_ASAR OUTPUT_APP_ASAR ASAR_MODULE_JS');
}
const target = path.resolve(outputAsar);
if (/\\WindowsApps\\/i.test(target) || fs.existsSync(target) || fs.existsSync(`${target}.source`)) {
  throw Error('Output must be a new path outside WindowsApps');
}
const source = path.resolve(sourceAsar);
const expected = 'C5FDEF328CFA2AD9095786F9C3A7AAA447E68834D31299D6EF2592DA02029038';
const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
if (digest(source) !== expected) throw Error('Vendor archive changed; offsets and injection sites require review');
const asar = await import(pathToFileURL(path.resolve(asarModule)));
const sourceTree = `${target}.source`;
asar.extractAll(source, sourceTree);
const local = path.dirname(fileURLToPath(import.meta.url));
const replaceOnce = (text, oldText, newText) => {
  if (text.split(oldText).length !== 2) throw Error(`Injection site is not unique: ${oldText.slice(0, 40)}`);
  return text.replace(oldText, newText);
};
const patch = (relative, transform) => {
  const file = path.join(sourceTree, relative);
  fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')));
};
patch('webview/assets/app-initial-b8e1c8014bb4.js', text => {
  text = replaceOnce(text,
    'children:[i,a,o,s,c,l,u,d,f,(0,N5.jsx)(rPc.Suspense,{fallback:p,children:n})]',
    'children:[i,a,o,s,c,l,u,d,f,(0,N5.jsx)(OaiRendererScopeProbe,{}),(0,N5.jsx)(rPc.Suspense,{fallback:p,children:n})]');
  return replaceOnce(text, '\n//# sourceMappingURL=app-initial-b8e1c8014bb4.js.map',
    '\n' + fs.readFileSync(path.join(local, 'renderer-bridge-component.js'), 'utf8').trim() +
    '\n//# sourceMappingURL=app-initial-b8e1c8014bb4.js.map');
});
patch('.vite/build/preload.js', text => replaceOnce(text,
  'e.contextBridge.exposeInMainWorld(`electronBridge`,z),typeof window<`u`',
  'e.contextBridge.exposeInMainWorld(`electronBridge`,z),e.contextBridge.exposeInMainWorld(`chatGPTPCBridge`,{ready:()=>e.ipcRenderer.send(`chatgpt-pc-bridge:ready`),emit:t=>e.ipcRenderer.send(`chatgpt-pc-bridge:event`,t),onRequest:t=>{let n=(e,n)=>t(n);e.ipcRenderer.on(`chatgpt-pc-bridge:request`,n);return()=>e.ipcRenderer.removeListener(`chatgpt-pc-bridge:request`,n)}}),typeof window<`u`'));
patch('.vite/build/early-bootstrap.js', text => replaceOnce(text,
  'd().catch(async e=>', 'require("./renderer-bridge-main.cjs");d().catch(async e=>'));
fs.copyFileSync(path.join(local, 'renderer-bridge-main.cjs'), path.join(sourceTree, '.vite/build/renderer-bridge-main.cjs'));
await asar.createPackageWithOptions(sourceTree, target, { unpack: '**/*.{node,dll,exe}' });
const headerHash = crypto.createHash('sha256').update(asar.getRawHeader(target).headerString).digest('hex');
fs.writeFileSync(`${target}.manifest.json`, JSON.stringify({
  source_sha256: expected, output_sha256: digest(target), header_sha256: headerHash,
  changed: ['webview/assets/app-initial-b8e1c8014bb4.js', '.vite/build/preload.js',
    '.vite/build/early-bootstrap.js', '.vite/build/renderer-bridge-main.cjs'],
  csp_changed: false, auth_changed: false,
}, null, 2));
console.log(JSON.stringify({ output_sha256: digest(target), header_sha256: headerHash }));
