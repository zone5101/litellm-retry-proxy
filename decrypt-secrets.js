// Giai ma secret cua VS Code SecretStorage (OSCrypt v10: AES-256-GCM) de lay lai NVIDIA API key.
// Master key (32 byte hex) do decrypt-nvkey.ps1 cung cap (DPAPI unprotect tu %APPDATA%\Code\Local State).
// Chi ghi ra file khi plaintext bat dau bang 'nvapi-' (khong in full secret ra man hinh).
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const [, , dbPath, keyHex] = process.argv;
if (!dbPath || !keyHex) { console.log('usage: node decrypt-secrets.js <db-copy> <masterKeyHex>'); process.exit(1); }
const key = Buffer.from(keyHex.trim(), 'hex');
if (key.length !== 32) { console.log('LOI: master key phai 32 byte, nhan duoc ' + key.length); process.exit(1); }
const txt = fs.readFileSync(dbPath, 'latin1');
const re = /\{"type":"Buffer","data":\[([0-9,\s]{30,40000})\]\}/g;
let m, v10 = 0, ok = 0, nvapi = 0;
const outFile = path.join(process.env.TEMP || '.', 'nvkey.tmp');
while ((m = re.exec(txt)) !== null) {
  const bytes = Buffer.from(m[1].split(',').map(n => parseInt(n, 10)));
  if (bytes.length < 31 || bytes[0] !== 118 || bytes[1] !== 49 || bytes[2] !== 48) continue;
  v10++;
  const nonce = bytes.subarray(3, 15);
  const tag = bytes.subarray(bytes.length - 16);
  const ct = bytes.subarray(15, bytes.length - 16);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    d.setAuthTag(tag);
    const s = Buffer.concat([d.update(ct), d.final()]).toString('utf8');
    ok++;
    if (s.startsWith('nvapi-')) {
      nvapi++;
      fs.writeFileSync(outFile, s.trim(), 'utf8');
      console.log('TIM THAY NVIDIA KEY: len=' + s.length + ' prefix=' + s.slice(0, 9) + '... -> da ghi ' + outFile);
    } else {
      console.log('  [secret khac] len=' + s.length + ' prefix=' + s.slice(0, 6).replace(/[\x00-\x1f]/g, '.') + '...');
    }
  } catch (e) { /* khong phai blob nay */ }
}
console.log('v10 blobs=' + v10 + ' decrypt_ok=' + ok + ' nvapi=' + nvapi);
if (nvapi === 0) console.log('Khong co plaintext nao bat dau bang nvapi- (kiem tra lai ten server / key khac prefix).');
