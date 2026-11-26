import {createAuthApi} from './backend/auth.mjs';
import {createMicrosoftApi} from './backend/microsoft.mjs';
import {setup} from './backend/setup.mjs';
import {ensureStructureSchema,createStructureApi} from './backend/structure.mjs';
import {ensureOcppSchema,createOcppBridge,createOcppApi} from './backend/ocpp.mjs';
import {createVirtualFleet} from './backend/virtual-fleet.mjs';
import {createOpsMonitorEndpoint} from './backend/ops-monitor-endpoint.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/login': ['login.html', 'text/html; charset=utf-8'],
  '/app': ['app.html', 'text/html; charset=utf-8'],
  '/app.html': ['app.html', 'text/html; charset=utf-8'],
  '/app-live.js': ['app-live.js', 'text/javascript; charset=utf-8'],
  '/portal-language.js': ['portal-language.js', 'text/javascript; charset=utf-8'],
  '/login.html': ['login.html', 'text/html; charset=utf-8'],
  '/login.js': ['login.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/exports.js': ['exports.js', 'text/javascript; charset=utf-8'],
  '/assets/blitz-bolt.svg': ['assets/blitz-bolt.svg', 'image/svg+xml'],
  '/assets/login-wallbox.webp': ['assets/login-wallbox.webp', 'image/webp'],
  '/assets/lumina-thumb.svg': ['assets/lumina-thumb.svg', 'image/svg+xml'],
  '/assets/chargevisor-logo.svg': ['assets/chargevisor-logo.svg', 'image/svg+xml'],
  '/assets/chargevisor-login-white.png': ['assets/chargevisor-login-white.png', 'image/png'],
  '/assets/walectra-logo.webp': ['assets/walectra-logo.webp', 'image/webp'],
  '/favicon.ico': ['assets/favicon-32.png', 'image/png'],
  '/apple-touch-icon.png': ['assets/apple-touch-icon.png', 'image/png'],
  '/assets/favicon-32.png': ['assets/favicon-32.png', 'image/png'],
  '/assets/apple-touch-icon.png': ['assets/apple-touch-icon.png', 'image/png'],
  '/assets/app-icon-192.png': ['assets/app-icon-192.png', 'image/png'],
  '/assets/app-icon-512.png': ['assets/app-icon-512.png', 'image/png'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
};

const port = Number(process.env.PORT || 10000);

const init = process.env.CV_INIT_DB==='1'?await setup():null;
if(init) console.log('ChargeVisor setup:',JSON.stringify(init));
const auth=await createAuthApi();
if(process.env.CV_DATABASE_URL&&!auth.ready())throw Error('ChargeVisor-Datenbank nicht verfügbar');
await ensureStructureSchema(auth.pool);
await ensureOcppSchema(auth.pool);
const ocppBridge=createOcppBridge(auth.pool);
const virtualFleet=auth.pool&&process.env.CV_VIRTUAL_AUTO==='1'?
  createVirtualFleet({pool:auth.pool,bridge:ocppBridge,port}):null;
const ocppApi=createOcppApi({pool:auth.pool,getActor:auth.getActor,bridge:ocppBridge,port,env:process.env});
const structure=createStructureApi(process.env,{pool:auth.pool,getActor:auth.getActor});
const microsoft=createMicrosoftApi(process.env,{pool:auth.pool,getActor:auth.getActor});
const opsMonitor=createOpsMonitorEndpoint({pool:auth.pool,env:process.env});
const canonical=process.env.CV_PUBLIC_URL?.trim().replace(/\/+$/,'');
const publicHost=['https://www.chargevisor.de','https://chargevisor.de'].includes(canonical)?new URL(canonical).host:null;
const httpServer=createServer(async (req, res) => {
  const url=new URL(req.url || '/', 'http://localhost');
  const pathname=url.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  if(pathname==='/api/ops/health'){await opsMonitor(req,res);return;}
  if(pathname.startsWith('/api/')&&!await auth.authorizeRolePreview(req,res,pathname))return;
  if(pathname.startsWith('/api/ocpp/')){await ocppApi(req,res,pathname);return;}
  if(pathname.startsWith('/api/microsoft/')){await microsoft.handle(req,res,pathname);return;}
  if(pathname.startsWith('/api/structure/')){await structure.handle(req,res,pathname);return;}
  if(pathname.startsWith('/api/')){await auth.handle(req,res,pathname);return;}
  if (pathname === '/health') {
    let ready=auth.ready();
    if(ready)try{await auth.pool.query({text:'SELECT 1',query_timeout:2500});}catch{ready=false;}
    const healthy=ready||!process.env.CV_DATABASE_URL;
    res.writeHead(healthy?200:503, {'Content-Type':'application/json; charset=utf-8'});
    return res.end(JSON.stringify({status:healthy?'ok':'unavailable',mode:auth.ready()?'auth':'demo',authReady:ready}));
  }
  if(publicHost&&['GET','HEAD'].includes(req.method)){
    const webPage=['/','/login','/login.html','/app','/app.html'].includes(pathname);
    const host=req.headers.host?.toLowerCase();
    if(webPage&&['www.chargevisor.de','chargevisor.de','chargevisor-business-demo.onrender.com'].includes(host)&&
       (pathname==='/'||host!==publicHost)){
      res.writeHead(302,{Location:canonical+(pathname==='/'?'/login':pathname)+url.search});
      return res.end();
    }
  }
  const match = files[pathname];
  if (!match || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
    return res.end('Not found');
  }
  try {
    const data = await readFile(new URL('./' + match[0], import.meta.url));
    res.writeHead(200, {'Content-Type':match[1]});
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    console.error('Static content error:', error);
    res.writeHead(500);
    res.end('Server error');
  }
});
httpServer.on('upgrade',(req,socket,head)=>{
  if(!String(req.url||'').startsWith('/ocpp/')){socket.destroy();return;}
  ocppBridge.upgrade(req,socket,head).catch(err=>{console.error('OCPP upgrade failed:',err.message);socket.destroy();});
});
httpServer.listen(port, '0.0.0.0', () => {
  if(virtualFleet){virtualFleet.start();console.log('ChargeVisor virtual OCPP fleet enabled (test stations only)');}
  if(auth.ready())console.log('ChargeVisor RFID: '+(ocppBridge.physical.configured?'enabled':'setup required'));
  console.log('ChargeVisor running on port ' + port + (auth.ready()?' (auth enabled)':' (demo + auth pending dedicated database)'));
});
