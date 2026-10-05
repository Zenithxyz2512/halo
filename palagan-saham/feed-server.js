// Jembatan feed untuk Palagan Saham.
//
// Bawaan: menyiarkan simulator (engine.js) lewat WebSocket, supaya jalur data bisa dicoba
// ujung ke ujung tanpa langganan apa pun. Untuk data asli, ganti blok SUMBER di bawah dengan
// adaptor dari feed order book berlisensi, lalu kirim pesan dengan format yang sama (lihat README).
//
//   npm install
//   node feed-server.js                              # port 8787, kode DEMO, acuan 4.850
//   node feed-server.js --code BBCA --prev 7500 --speed 5 --scenario akumulasi
//   lalu buka index.html?feed=ws://localhost:8787
'use strict';
const { WebSocketServer } = require('ws');
const P = require('./engine.js');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg('port', 8787);
const CODE = String(arg('code', 'DEMO')).toUpperCase();
const PREV = P.floorTick(Math.max(1, Math.round(+arg('prev', 4850))));
const SPEED = Math.max(0.1, +arg('speed', 5));
const SCENARIO = arg('scenario', 'normal');

const hhmmss = (c) => [c / 3600, (c % 3600) / 60, c % 60].map((x) => String(Math.floor(x)).padStart(2, '0')).join(':');
const wss = new WebSocketServer({ port: PORT });
const broadcast = (msg) => { const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === 1) c.send(s); };

// ------------------------------------------------------------------ SUMBER
// Ganti blok ini dengan adaptor vendor: setiap ada perubahan antrean kirim 'book',
// setiap transaksi kirim 'trade' (atau 'trades'), setiap ganti sesi kirim 'phase'.
let market, sim, lastPhase;
function startDay(prev, date) {
  const d = date || new Date(Date.now() + 7 * 3600e3);
  const dow = d.getUTCDay() >= 1 && d.getUTCDay() <= 5 ? d.getUTCDay() : 1;
  market = new P.Market({ code: CODE, prev, date: d.toISOString().slice(0, 10), dow });
  sim = new P.Simulator(market, { scenario: SCENARIO });
  lastPhase = market.phase;
  broadcast(hello());
}
const hello = () => ({ type: 'hello', code: market.code, prev: market.prev, date: market.date, clock: hhmmss(market.clock), phase: market.phase });
const book = () => ({
  type: 'book',
  bids: market.top('B', 20).map((l) => [l.p, l.lot, l.freq]),
  offers: market.top('S', 20).map((l) => [l.p, l.lot, l.freq]),
});

startDay(PREV);
const TICK_MS = 250;
setInterval(() => {
  if (market.phase === 'CLOSED') {
    const next = new Date(Date.parse(market.date + 'T00:00:00Z') + 864e5);
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next.setUTCDate(next.getUTCDate() + 1);
    startDay(market.close || market.prev, next);
    return;
  }
  // Pre-opening, istirahat, dan pre-closing dipercepat supaya demo tidak menunggu lama.
  const rate = market.phase === 'BREAK' ? 900 : P.isAuction(market.phase) ? Math.max(SPEED, 40) : SPEED;
  let left = (TICK_MS / 1000) * rate;
  while (left > 0) { const h = Math.min(0.5, left); sim.step(h); left -= h; }
  const { trades } = market.drain();
  if (trades.length) {
    broadcast({
      type: 'trades',
      items: trades.map((t) => ({
        t: hhmmss(t.t), price: t.price, lot: t.lot, side: t.side,
        buyer: t.bF * 2 >= t.lot ? 'F' : 'D', seller: t.sF * 2 >= t.lot ? 'F' : 'D',
      })),
    });
  }
  if (market.phase !== lastPhase) { lastPhase = market.phase; broadcast({ type: 'phase', phase: market.phase, clock: hhmmss(market.clock) }); }
  broadcast(book());
}, TICK_MS);
// ---------------------------------------------------------------- /SUMBER

wss.on('connection', (ws) => { ws.send(JSON.stringify(hello())); ws.send(JSON.stringify(book())); });
console.log(`Feed ${CODE} (acuan ${PREV}) di ws://localhost:${PORT} — buka index.html?feed=ws://localhost:${PORT}`);
