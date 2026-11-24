/**
 * ChargeVisor Business V1 UI freeze.
 * User-approved baseline: public dev main 4f122a6d41338c017848b8270e3b769817366766.
 * Explicit UI-specific change requested 23 Nov 2026: Play/Pause/Stop state logic
 * and manual read-only diagnostics trigger in app-live.js ONLY.
 * 23 Nov 2026, UI-specific stability repair: 12-second OCPP polling now patches
 * only changed DOM values instead of reloading the Lumina/chart/customer view. The other 13
 * exact visual/HTML/CSS/logo/export fingerprints remain frozen below.
 * 24 Nov: user-approved management-only RFID list, filter and premium invite styling.
 * 24 Nov: user-approved shared premium action styling only (invite, PDF, charging and reset).
 * 24 Nov: approved favicon / home-screen icon metadata and four new PNGs only.
 * No design, CSS, HTML, JS application logic, branding or existing export changes
 * may silently enter backend/OCPP pull requests.
 *
 * This checker uses the exact git blob SHA-1 fingerprint for each file
 * (including whitespace). It also rejects additional root UI files/assets.
 * To intentionally change the UI, change the contract in a separately
 * approved UI-specific PR. Do NOT amend these hashes to make a backend PR pass.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baseline='4f122a6d41338c017848b8270e3b769817366766';
const files=Object.freeze({
  'app-live.js':'1aea180df6297c2ebadd6d6a3735ce32f05def24',
  'app.html':'515eb3466bb0aa8e02cd6eb9a6286c3e42bead01',
  'app.js':'72eb69d35fb9b24e60a019bf098dc9c95fbb7aba',
  'index.html':'da82378bf7aa2e4a180f6a414ca62f97d5a41bb0',
  'login.html':'0bd2264014111d1e2a194d2503787d8c68a867ad',
  'login.js':'259677446a0a96c1116654bcd704aa3454493abf',
  'styles.css':'3e01daeec8aac7d35c0f8496fcc3222c39905688',
  'portal-language.js':'dcc00d5bb54434cab960103819d6074941179c7b',
  'exports.js':'79a20c6bd8366d4d9f3d8135b0d0ca8f902e51e3',
  'manifest.webmanifest':'25f5a43e8891ffb8ba8a5c95f8bd1ff344fb48a6',
  'assets/favicon-32.png':'0cd48a8af91bcc6f9290685df2c106a439389716',
  'assets/apple-touch-icon.png':'e7cfcafa97678f86916f6f20e15ebabf5a2a3948',
  'assets/app-icon-192.png':'137962970adfd3f397bb2d4fcaec8fbddd69b7f3',
  'assets/app-icon-512.png':'61f6c3cccd48b74703c25d65ba0f19909df0a5a6',
  'assets/blitz-bolt.svg':'afd4e3212eb5cf3f99a4a915e16fd46775e89d1d',
  'assets/chargevisor-logo.svg':'b6f8ac85be4f6f4d1a08ee035249d861d4117bb2',
  'assets/login-wallbox.webp':'82e57107802b1bf6c6ed13aacd0fe04c569e2ecb',
  'assets/lumina-thumb.svg':'188e639d39002562aa7c3f6a31ad742a39564a48',
  'assets/walectra-logo.webp':'878cbd5b569e30ac92429eab4361d64abffbc500'
});

function gitBlobSha(bytes){
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
const actualRoots=(await readdir(root)).filter(name=>/\.(?:html|css|js|webmanifest)$/.test(name)).sort();
const expectedRoots=Object.keys(files).filter(name=>!name.includes('/')).sort();
assert.deepEqual(actualRoots,expectedRoots,
  'New/removed frontend root file detected. V1 UI may not be modified in backend PRs');
const assetNames=(await readdir(resolve(root,'assets'))).sort();
const expectedAssets=Object.keys(files).filter(name=>name.startsWith('assets/'))
  .map(name=>name.slice('assets/'.length)).sort();
assert.deepEqual(assetNames,expectedAssets,'New/removed frontend asset detected');
for(const [name,expected] of Object.entries(files)){
  const bytes=await readFile(resolve(root,name));
  const actual=gitBlobSha(bytes);
  assert.equal(actual,expected,
    'FRONTEND CHANGED: '+name+' differs from approved '+baseline+' baseline. '+
    'Do not silently update frontend designs/assets with backend OCPP changes.');
}
console.log('ChargeVisor V1 UI freeze PASS: '+Object.keys(files).length+
  ' frontend files and assets match GitHub commit '+baseline.slice(0,7));
