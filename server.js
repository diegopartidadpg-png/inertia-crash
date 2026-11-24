// Inertia Crash online server: serves the game AND runs live multiplayer + leaderboard. No npm install needed.
// Run:  node server.js     then open http://localhost:3000   (hosts like Render/Railway/Glitch use PORT automatically)
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000, LB_FILE = path.join(__dirname, 'leaderboard.json');
const players = new Map(); // socket -> {id, n, x,y,z,r,m,lv,c,k, seen}
let best = {}; try { best = JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); } catch (e) {}
let saveT = null; const saveLb = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(LB_FILE, JSON.stringify(best), () => {}), 2000); };
const clean = s => String(s || '').replace(/[^\w \-.!?]/g, '').trim().slice(0, 14) || 'Driver';
const num = (v, lim) => Number.isFinite(+v) ? Math.max(-lim, Math.min(lim, +v)) : 0;

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  fs.readFile(path.join(__dirname, 'index.html'), (e, d) => { if (e) { res.writeHead(404); res.end('index.html missing'); return; } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d); });
});
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key']; if (!key || players.size >= 100) { sock.destroy(); return; }
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  const me = { id: '', n: 'Driver', x: 0, y: 0, z: 0, r: 0, m: 0, lv: 1, c: 0, o: -1, a: -1, k: 0, seen: Date.now(), last: 0 }; players.set(sock, me);
  let buf = Buffer.alloc(0);
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      const op = buf[0] & 15; let len = buf[1] & 127, off = 2;
      if (!(buf[1] & 128)) { sock.destroy(); return; }
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { sock.destroy(); return; }
      if (len > 2048) { sock.destroy(); return; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.slice(off, off + 4), p = Buffer.from(buf.slice(off + 4, off + 4 + len)); for (let i = 0; i < len; i++) p[i] ^= mask[i & 3];
      buf = buf.slice(off + 4 + len);
      if (op === 8) { sock.end(); return; } if (op === 9) { sock.write(Buffer.from([0x8a, 0])); continue; } if (op !== 1) continue;
      let m; try { m = JSON.parse(p.toString()); } catch (e) { continue; } me.seen = Date.now();
      if (m.t === 'hi') { me.id = String(m.id || '').replace(/\W/g, '').slice(0, 16); me.n = clean(m.n); if (me.id && +m.d > 0 && +m.d < 1e6 && +m.d > ((best[me.id] || {}).d || 0)) { best[me.id] = { n: me.n, d: Math.round(+m.d) }; saveLb(); } else if (best[me.id]) best[me.id].n = me.n; }
      else if (m.t === 'best' && me.id) { const d = Math.round(num(m.d, 1e6)); if (d > ((best[me.id] || {}).d || 0)) { best[me.id] = { n: me.n, d }; saveLb(); } }
      else if (m.t === 'p' && me.id && Date.now() - me.last > 40) { me.last = Date.now(); me.n = clean(m.n); me.x = num(m.x, 1e5); me.y = num(m.y, 1e5); me.z = num(m.z, 1e6); me.r = num(m.r, 20); me.m = m.m === 1 ? 1 : m.m === 2 ? 2 : 0; me.lv = num(m.lv, 1e4) | 0; me.c = num(m.c, 99) | 0; me.k = num(m.k, 0xffffff) | 0; me.o = num(m.o, 99) | 0; me.a = num(m.a, 99) | 0; }
    }
  });
  const gone = () => players.delete(sock); sock.on('close', gone); sock.on('error', gone);
});
const frame = s => { const p = Buffer.from(s); let h; if (p.length < 126) h = Buffer.from([0x81, p.length]); else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); } return Buffer.concat([h, p]); };
setInterval(() => {
  const now = Date.now(), ps = [];
  for (const [s, p] of players) { if (now - p.seen > 15000) { s.destroy(); players.delete(s); continue; } if (p.id) ps.push({ id: p.id, n: p.n, x: p.x, y: p.y, z: p.z, r: p.r, m: p.m, lv: p.lv, c: p.c, o: p.o, a: p.a, k: p.k }); }
  const lb = Object.entries(best).map(([id, v]) => ({ id, n: v.n, d: v.d })).sort((a, b) => b.d - a.d).slice(0, 10);
  const out = frame(JSON.stringify({ t: 'w', ps, lb, o: ps.length }));
  for (const s of players.keys()) s.write(out);
}, 100);
server.listen(PORT, () => console.log('Inertia Crash online on http://localhost:' + PORT));
