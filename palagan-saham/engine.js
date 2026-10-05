/* Palagan Saham — mesin pasar (engine.js)
 *
 * Aturan perdagangan BEI yang dipakai (dicek Oktober 2026, sumber di README):
 *  - 1 lot = 100 lembar. Harga minimum Rp1 (berlaku 28 Sep 2026).
 *  - Fraksi harga: <Rp200 → Rp1 · Rp200–<500 → Rp2 · Rp500–<2.000 → Rp5 ·
 *    Rp2.000–<5.000 → Rp10 · ≥Rp5.000 → Rp25.
 *  - Auto rejection dari harga acuan: Rp1–10 → Rp1 · Rp11–200 → ARA 35% ·
 *    >Rp200–5.000 → ARA 25% · >Rp5.000 → ARA 20%. ARB 15% s.d. 31 Des 2026,
 *    mulai 1 Jan 2027 ARB sama dengan ARA.
 *  - Sesi Senin–Kamis: pre-opening 08:45, sesi 1 09:00–12:00, sesi 2
 *    13:30–15:50, pre-closing 15:50–16:00. Jumat: sesi 1 s.d. 11:30, sesi 2 mulai 14:00.
 *
 * Tanpa DOM: dipakai halaman (window.Palagan) dan Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Palagan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- aturan BEI
  const LOT = 100;
  const MIN_PRICE = 1;

  const BANDS = [
    { lo: 1, hi: 200, tick: 1 },
    { lo: 200, hi: 500, tick: 2 },
    { lo: 500, hi: 2000, tick: 5 },
    { lo: 2000, hi: 5000, tick: 10 },
    { lo: 5000, hi: Infinity, tick: 25 },
  ];
  (function () {
    let i = 0;
    for (const b of BANDS) { b.i0 = i; if (b.hi !== Infinity) i += (b.hi - b.lo) / b.tick; }
  })();

  function bandOf(p) {
    for (let k = BANDS.length - 1; k > 0; k--) if (p >= BANDS[k].lo) return BANDS[k];
    return BANDS[0];
  }
  const tickSize = (p) => bandOf(p).tick;
  const isValidPrice = (p) => Number.isInteger(p) && p >= MIN_PRICE && p % tickSize(p) === 0;
  const floorTick = (x) => { const t = tickSize(x); return Math.max(MIN_PRICE, Math.floor(x / t) * t); };
  const ceilTick = (x) => { const t = tickSize(Math.max(x, MIN_PRICE)); return Math.max(MIN_PRICE, Math.ceil(x / t) * t); };

  // Indeks tangga harga: harga sah ke-n (Rp1 = 0). Satu langkah = satu fraksi,
  // jadi jarak antarbaris di medan selalu sama walau fraksinya berganti.
  const priceIndex = (p) => { const b = bandOf(p); return b.i0 + (p - b.lo) / b.tick; };
  function priceAt(i) {
    i = Math.max(0, Math.round(i));
    for (let k = BANDS.length - 1; k >= 0; k--) { const b = BANDS[k]; if (i >= b.i0) return b.lo + (i - b.i0) * b.tick; }
    return MIN_PRICE;
  }
  const stepPrice = (p, n) => priceAt(priceIndex(p) + n);

  function arLimits(ref, date) {
    if (ref <= 10) return { ara: ref + 1, arb: Math.max(MIN_PRICE, ref - 1), araPct: null, arbPct: null };
    const A = ref <= 200 ? 35 : ref <= 5000 ? 25 : 20;
    const B = String(date || '') >= '2027-01-01' ? A : 15;
    return {
      ara: floorTick((ref * (100 + A)) / 100),
      arb: Math.max(MIN_PRICE, ceilTick((ref * (100 - B)) / 100)),
      araPct: A,
      arbPct: B,
    };
  }

  const H = (h, m = 0, s = 0) => h * 3600 + m * 60 + s;
  function sessionPlan(dow) {
    const fri = dow === 5;
    return [
      { phase: 'PRE_OPEN', from: H(8, 45), to: H(9) },
      { phase: 'S1', from: H(9), to: fri ? H(11, 30) : H(12) },
      { phase: 'BREAK', from: fri ? H(11, 30) : H(12), to: fri ? H(14) : H(13, 30) },
      { phase: 'S2', from: fri ? H(14) : H(13, 30), to: H(15, 50) },
      { phase: 'PRE_CLOSE', from: H(15, 50), to: H(16) },
      { phase: 'CLOSED', from: H(16), to: H(24) },
    ];
  }
  function phaseAt(plan, clock) {
    if (clock < plan[0].from) return 'CLOSED';
    for (const s of plan) if (clock < s.to) return s.phase;
    return 'CLOSED';
  }
  const PHASE_LABEL = {
    PRE_OPEN: 'Pre-opening', S1: 'Sesi 1', BREAK: 'Istirahat', S2: 'Sesi 2', PRE_CLOSE: 'Pre-closing', CLOSED: 'Tutup',
  };
  const isContinuous = (ph) => ph === 'S1' || ph === 'S2';
  const isAuction = (ph) => ph === 'PRE_OPEN' || ph === 'PRE_CLOSE';

  // "08:59:30" atau epoch ms → detik sejak 00:00 WIB
  function parseClock(t) {
    if (typeof t === 'number' && t > 1e11) return Math.floor((t / 1000 + 7 * 3600) % 86400);
    if (typeof t === 'number') return t;
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(t || ''));
    return m ? H(+m[1], +m[2], +(m[3] || 0)) : null;
  }

  // Ukuran order eceran khas: sekitar Rp15 juta.
  const baseLotFor = (price) => Math.max(1, Math.min(50000, Math.round(1.5e7 / (Math.max(price, 1) * LOT))));

  // ----------------------------------------------------------- acak terkendali
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
  function poisson(r, m) {
    if (!(m > 0)) return 0;
    if (m > 30) return Math.max(0, Math.round(m + Math.sqrt(m) * gauss(r)));
    const L = Math.exp(-m); let k = 0, p = 1;
    do { k++; p *= r(); } while (p > L);
    return k - 1;
  }
  const lognormal = (r, median, s) => median * Math.exp(s * gauss(r));
  function geometric(r, q) { let k = 0; while (r() < q && k < 40) k++; return k; }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------- order book
  class Side {
    constructor(isBid) { this.isBid = isBid; this.levels = []; }
    seek(p) {
      const L = this.levels; let lo = 0, hi = L.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (this.isBid ? L[m].p > p : L[m].p < p) lo = m + 1; else hi = m; }
      return lo;
    }
    get(p) { const L = this.levels[this.seek(p)]; return L && L.p === p ? L : null; }
    ensure(p, clock) {
      const i = this.seek(p); let L = this.levels[i];
      if (!L || L.p !== p) {
        L = { p, lot: 0, q: [], traded: 0, cancelled: 0, pending: 0, nf: null, born: clock };
        this.levels.splice(i, 0, L);
      }
      return L;
    }
    drop(L) { const i = this.levels.indexOf(L); if (i >= 0) this.levels.splice(i, 1); }
    best() { return this.levels.length ? this.levels[0].p : null; }
    depth(n = Infinity) { let s = 0; for (let i = 0; i < this.levels.length && i < n; i++) s += this.levels[i].lot; return s; }
  }
  const freqOf = (L) => (L.nf != null ? L.nf : L.q.length);

  // --------------------------------------------------------------------- pasar
  class Market {
    constructor(o) {
      this.code = String(o.code || 'DEMO').toUpperCase();
      this.prev = o.prev;
      this.date = o.date || '';
      this.dow = o.dow == null ? 1 : o.dow;
      this.plan = sessionPlan(this.dow);
      this.limits = arLimits(this.prev, this.date);
      this.baseLot = baseLotFor(this.prev);
      this.bids = new Side(true);
      this.offers = new Side(false);
      this.clock = o.clock == null ? this.plan[0].from : o.clock;
      this.phase = phaseAt(this.plan, this.clock);
      this.last = null; this.open = null; this.high = null; this.low = null; this.close = null;
      this.volume = 0; this.value = 0; this.freq = 0; this.fbuy = 0; this.fsell = 0;
      this.haka = 0; this.haki = 0;
      this.pw = { b: new Float64Array(30), s: new Float64Array(30), k: -1 };
      this.history = [];
      this.trades = []; this.events = [];
      this.walls = new Map();
      this.wallT = Infinity;
      this.atLimit = null;
      this.bandTick = tickSize(this.prev); this.bandT = -1e9;
      this.live = [];
      this.seq = 1;
    }

    event(kind, data) { this.events.push(Object.assign({ t: this.clock, kind }, data)); }
    drain() { const out = { trades: this.trades, events: this.events }; this.trades = []; this.events = []; return out; }
    bigLot() { return Math.max(25 * this.baseLot, Math.ceil(5e8 / (LOT * (this.last || this.prev)))); }
    side(s) { return s === 'B' ? this.bids : this.offers; }

    // Order masuk. Ditolak (null) kalau fraksi salah, di luar ARA/ARB, atau pasar tidak menerima order.
    submit(side, p, lot, f = false, tag = 'lp') {
      lot = Math.round(lot);
      if (!(lot > 0) || !isValidPrice(p) || p > this.limits.ara || p < this.limits.arb) return null;
      if (this.phase === 'BREAK' || this.phase === 'CLOSED') return null;
      const o = { id: this.seq++, side, p, lot, f: !!f, tag, dead: false };
      if (isContinuous(this.phase)) this.match(o);
      if (o.lot > 0) {
        const L = this.side(side).ensure(p, this.clock);
        L.q.push(o); L.lot += o.lot;
        this.live.push(o);
      } else o.dead = true;
      return o;
    }

    // Pencocokan prioritas harga lalu waktu, di harga order yang antre (pasif).
    match(o) {
      const opp = o.side === 'B' ? this.offers : this.bids;
      let total = 0, value = 0, from = null, to = null, rec = null;
      while (o.lot > 0 && opp.levels.length) {
        const L = opp.levels[0];
        if (o.side === 'B' ? L.p > o.p : L.p < o.p) break;
        while (o.lot > 0 && L.q.length) {
          const r = L.q[0];
          const q = Math.min(o.lot, r.lot);
          r.lot -= q; L.lot -= q; o.lot -= q; L.traded += q;
          if (r.lot === 0) { L.q.shift(); r.dead = true; }
          const bF = o.side === 'B' ? o.f : r.f, sF = o.side === 'B' ? r.f : o.f;
          this.fill(L.p, q, o.side, bF, sF);
          total += q; value += q * LOT * L.p;
          if (from === null) from = L.p;
          to = L.p;
          if (!rec || rec.price !== L.p) { rec = { t: this.clock, price: L.p, lot: 0, side: o.side, bF: 0, sF: 0 }; this.trades.push(rec); }
          rec.lot += q; if (bF) rec.bF += q; if (sF) rec.sF += q;
        }
        if (L.lot <= 0) opp.levels.shift();
      }
      if (total >= this.bigLot()) this.event('big', { side: o.side, lot: total, value, from, to, tag: o.tag });
      return total;
    }

    fill(p, q, aggr, bF, sF) {
      const v = q * LOT * p;
      this.volume += q; this.value += v; this.freq += 1;
      if (bF) this.fbuy += v;
      if (sF) this.fsell += v;
      if (aggr === 'B') this.haka += q; else if (aggr === 'S') this.haki += q;
      this.roll();
      const i = this.pw.k % 30;
      if (aggr === 'B') this.pw.b[i] += q; else if (aggr === 'S') this.pw.s[i] += q;
      const before = this.last;
      this.last = p;
      if (this.open === null) this.open = p;
      if (this.high === null || p > this.high) this.high = p;
      if (this.low === null || p < this.low) this.low = p;
      // Pindah rentang fraksi diumumkan sekali per 5 menit supaya harga yang mondar-mandir di batas tidak berisik.
      if (before !== null && tickSize(p) !== this.bandTick && this.clock - this.bandT >= 300) {
        this.event('band', { from: this.bandTick, to: tickSize(p), p });
        this.bandTick = tickSize(p); this.bandT = this.clock;
      }
    }

    // Jendela tekanan beli/jual: 30 ember × 10 detik = 5 menit terakhir.
    roll() {
      const k = Math.floor(this.clock / 10), W = this.pw;
      if (W.k === k) return;
      if (W.k < 0 || k < W.k || k - W.k >= 30) { W.b.fill(0); W.s.fill(0); }
      else for (let j = W.k + 1; j <= k; j++) { W.b[j % 30] = 0; W.s[j % 30] = 0; }
      W.k = k;
    }
    pressure() {
      this.roll();
      let b = 0, s = 0;
      for (let i = 0; i < 30; i++) { b += this.pw.b[i]; s += this.pw.s[i]; }
      return { b, s };
    }

    cancel(o, lot) {
      if (o.dead) return 0;
      const S = this.side(o.side), L = S.get(o.p);
      if (!L) { o.dead = true; return 0; }
      const q = Math.min(lot == null ? o.lot : lot, o.lot);
      o.lot -= q; L.lot -= q; L.cancelled += q;
      if (o.lot === 0) { o.dead = true; const i = L.q.indexOf(o); if (i >= 0) L.q.splice(i, 1); }
      if (L.lot <= 0) S.drop(L);
      return q;
    }

    randomLive(r, filter) {
      for (let tries = 0; tries < 8 && this.live.length; tries++) {
        const i = Math.floor(r() * this.live.length), o = this.live[i];
        if (o.dead) { this.live[i] = this.live[this.live.length - 1]; this.live.pop(); continue; }
        if (!filter || filter(o)) return o;
      }
      return null;
    }

    // Harga keseimbangan call auction: volume terbanyak, lalu selisih terkecil, lalu terdekat ke harga acuan.
    computeIEP() {
      const B = this.bids.levels, O = this.offers.levels;
      if (!B.length || !O.length || B[0].p < O[0].p) return { p: null, v: 0 };
      const cands = new Set();
      for (const L of B) if (L.p >= O[0].p) cands.add(L.p);
      for (const L of O) if (L.p <= B[0].p) cands.add(L.p);
      const ref = this.last || this.prev;
      let best = null;
      for (const p of cands) {
        let bc = 0; for (const L of B) { if (L.p >= p) bc += L.lot; else break; }
        let oc = 0; for (const L of O) { if (L.p <= p) oc += L.lot; else break; }
        const v = Math.min(bc, oc), imb = Math.abs(bc - oc), d = Math.abs(p - ref);
        if (!best || v > best.v || (v === best.v && (imb < best.imb || (imb === best.imb && d < best.d)))) best = { p, v, imb, d };
      }
      return best && best.v > 0 ? { p: best.p, v: best.v } : { p: null, v: 0 };
    }

    runAuction() {
      const { p } = this.computeIEP();
      if (p === null) return null;
      const B = this.bids, O = this.offers;
      const rec = { t: this.clock, price: p, lot: 0, side: 'A', bF: 0, sF: 0 };
      while (B.levels.length && O.levels.length && B.levels[0].p >= O.levels[0].p) {
        const LB = B.levels[0], LO = O.levels[0], b = LB.q[0], s = LO.q[0];
        const q = Math.min(b.lot, s.lot);
        b.lot -= q; s.lot -= q; LB.lot -= q; LO.lot -= q; LB.traded += q; LO.traded += q;
        if (b.lot === 0) { LB.q.shift(); b.dead = true; }
        if (s.lot === 0) { LO.q.shift(); s.dead = true; }
        if (LB.lot <= 0) B.levels.shift();
        if (LO.lot <= 0) O.levels.shift();
        this.fill(p, q, 'A', b.f, s.f);
        rec.lot += q; if (b.f) rec.bF += q; if (s.f) rec.sF += q;
      }
      if (rec.lot) this.trades.push(rec);
      if (rec.lot >= this.bigLot()) this.event('big', { side: 'A', lot: rec.lot, value: rec.lot * LOT * p, from: p, to: p, tag: 'auction' });
      return { p, v: rec.lot };
    }

    // Geser jam pasar; jalankan perpindahan sesi satu per satu.
    advanceTo(clock) {
      this.clock = clock;
      const target = phaseAt(this.plan, clock);
      let guard = 0;
      while (this.phase !== target && guard++ < 8) {
        const idx = this.plan.findIndex((s) => s.phase === this.phase);
        const next = idx < 0 ? target : this.plan[Math.min(idx + 1, this.plan.length - 1)].phase;
        this.transition(this.phase, next);
      }
      return this.phase;
    }

    transition(from, to) {
      if (from === 'PRE_OPEN') {
        const r = this.runAuction();
        this.event('open', { p: r ? r.p : null, v: r ? r.v : 0 });
      }
      if (from === 'PRE_CLOSE') {
        const r = this.runAuction();
        this.close = this.last == null ? this.prev : this.last;
        this.event('close', { p: this.close, v: r ? r.v : 0 });
        this.bids.levels = []; this.offers.levels = []; this.live = []; this.walls.clear(); this.atLimit = null;
      }
      this.phase = to;
      this.event('phase', { from, to });
    }

    // Tembok: antrean jauh lebih tebal dari level lain (6× median 10 level teratas).
    scanWalls() {
      if (!isContinuous(this.phase)) return;
      const top = [];
      for (let i = 0; i < 10; i++) {
        if (this.bids.levels[i]) top.push(this.bids.levels[i].lot);
        if (this.offers.levels[i]) top.push(this.offers.levels[i].lot);
      }
      top.sort((a, b) => a - b);
      const med = top.length ? top[top.length >> 1] : 0;
      const T = top.length >= 4 ? Math.max(6 * med, 60 * this.baseLot) : Infinity;
      this.wallT = T;
      for (const side of ['B', 'S']) {
        const S = this.side(side);
        for (let i = 0; i < Math.min(10, S.levels.length); i++) {
          const L = S.levels[i], key = side + L.p;
          if (L.lot >= T && !this.walls.has(key)) {
            this.walls.set(key, { side, p: L.p, L, peak: L.lot });
            this.event('wall', { side, p: L.p, lot: L.lot });
          }
        }
      }
      for (const [key, w] of this.walls) {
        const alive = this.side(w.side).get(w.p) === w.L;
        if (alive) w.peak = Math.max(w.peak, w.L.lot);
        if (!alive || w.L.lot < 0.45 * Math.min(T, w.peak)) {
          this.walls.delete(key);
          this.event('wallGone', { side: w.side, p: w.p, how: w.L.traded >= w.L.cancelled ? 'jebol' : 'ditarik', peak: w.peak });
        }
      }
    }
    isWall(side, p) { return this.walls.has(side + p); }

    scanLimit() {
      if (!isContinuous(this.phase)) return;
      const bb = this.bids.best(), bo = this.offers.best();
      let s = null;
      if (bb !== null && bb === this.limits.ara && this.last === bb) s = 'ARA';
      else if (bo !== null && bo === this.limits.arb && this.last === bo) s = 'ARB';
      if (s !== this.atLimit) {
        this.atLimit = s;
        if (s) this.event(s === 'ARA' ? 'ara' : 'arb', { p: s === 'ARA' ? bb : bo, lot: (s === 'ARA' ? this.bids : this.offers).levels[0].lot });
      }
    }

    top(side, n) {
      const S = this.side(side), out = [];
      for (let i = 0; i < Math.min(n, S.levels.length); i++) {
        const L = S.levels[i];
        out.push({ p: L.p, lot: L.lot, freq: freqOf(L), wall: this.walls.has(side + L.p) });
      }
      return out;
    }

    // ---- masukan dari feed luar (mode live) ----
    applyBook(bids, offers) {
      for (const [side, rows] of [['B', bids], ['S', offers]]) {
        const S = this.side(side);
        const old = new Map(S.levels.map((L) => [L.p, L]));
        const next = [];
        for (const row of rows || []) {
          const p = Math.round(+row[0]), lot = Math.round(+row[1]);
          if (!(p > 0) || !(lot > 0)) continue;
          let L = old.get(p);
          if (L) {
            old.delete(p);
            const dec = L.lot - lot;
            if (dec > 0) L.cancelled += Math.max(0, dec - L.pending);
          } else L = { p, lot: 0, q: [], traded: 0, cancelled: 0, pending: 0, nf: null, born: this.clock };
          L.pending = 0; L.lot = lot; L.nf = row[2] != null ? Math.round(+row[2]) : null;
          next.push(L);
        }
        for (const L of old.values()) L.cancelled += Math.max(0, L.lot - L.pending);
        next.sort((a, b) => (side === 'B' ? b.p - a.p : a.p - b.p));
        S.levels = next;
      }
      this.scanWalls();
      this.scanLimit();
    }

    applyTrade(tr) {
      const p = Math.round(+tr.price), q = Math.round(+tr.lot);
      if (!(p > 0) || !(q > 0)) return;
      const c = tr.t != null ? parseClock(tr.t) : null;
      if (c != null) this.clock = c;
      let side = tr.side === 'B' || tr.side === 'S' || tr.side === 'A' ? tr.side : null;
      if (!side) {
        const bo = this.offers.best(), bb = this.bids.best();
        side = bo !== null && p >= bo ? 'B' : bb !== null && p <= bb ? 'S' : this.last !== null && p < this.last ? 'S' : 'B';
      }
      const bF = tr.buyer === 'F', sF = tr.seller === 'F';
      this.fill(p, q, side, bF, sF);
      if (side !== 'A') { const L = (side === 'B' ? this.offers : this.bids).get(p); if (L) { L.pending += q; L.traded += q; } }
      this.trades.push({ t: this.clock, price: p, lot: q, side, bF: bF ? q : 0, sF: sF ? q : 0 });
      if (q >= this.bigLot()) this.event('big', { side, lot: q, value: q * LOT * p, from: p, to: p, tag: 'feed' });
      if (!this.history.length || this.clock - this.history[this.history.length - 1][0] >= 30) this.history.push([this.clock, p]);
      this.scanLimit();
    }

    applyPhase(phase, clock) {
      const c = clock != null ? parseClock(clock) : null;
      if (c != null) this.clock = c;
      if (phase && PHASE_LABEL[phase] && phase !== this.phase) {
        const from = this.phase;
        this.phase = phase;
        this.event('phase', { from, to: phase });
      }
    }

    applyStats(st) {
      for (const k of ['open', 'high', 'low', 'close', 'volume', 'value', 'freq', 'fbuy', 'fsell']) {
        if (st[k] != null && isFinite(+st[k])) this[k] = +st[k];
      }
      if (st.last != null && isFinite(+st.last)) this.last = +st.last;
    }
  }

  // ----------------------------------------------------------------- simulator
  const SCENARIOS = {
    normal: { label: 'Normal', vol: 3, drift: 0, revert: 1 / 9000, taker: 1, depth: 1, big: 1, wallSide: 0, foreign: 0,
      note: 'Dua kubu seimbang, harga mengembara pelan.' },
    akumulasi: { label: 'Akumulasi', vol: 2.5, drift: 0.9, taker: 1, depth: 1, big: 1.8, wallSide: 1, foreign: 0.4,
      note: 'Pemain besar menumpuk bid tebal di bawah harga dan menyerap jualan. Asing cenderung net beli.' },
    distribusi: { label: 'Distribusi', vol: 2.5, drift: -0.9, taker: 1, depth: 1, big: 1.8, wallSide: -1, foreign: -0.4,
      note: 'Offer tebal dipasang di atas harga untuk melepas barang pelan-pelan. Asing cenderung net jual.' },
    ara: { label: 'Kejar ARA', vol: 3.5, drift: 14, taker: 1.7, depth: 0.8, big: 2.6, wallSide: 1, foreign: 0.25,
      note: 'Pembeli agresif menyapu offer sampai mentok batas atas, lalu antre di ARA.' },
    arb: { label: 'Panik ARB', vol: 3.5, drift: -9, taker: 1.7, depth: 0.8, big: 2.6, wallSide: -1, foreign: -0.35,
      note: 'Jual panik menghajar bid sampai batas bawah, lalu antre jual di ARB.' },
    gorengan: { label: 'Gorengan', vol: 10, drift: 0, revert: 1 / 5000, jump: 1 / 900, taker: 1.6, depth: 0.35, big: 3, wallSide: 0, foreign: 0,
      note: 'Antrean tipis, lonjakan dan jebolan mendadak di dua arah.' },
  };
  const BASE = { taker: 0.95, lp: 2.6, depth: 300, cancel: 1 / 420, bandar: 1 / 420, auction: 0.45, q: 0.66 };

  class Simulator {
    constructor(market, opts = {}) {
      this.m = market;
      this.rng = mulberry32(opts.seed == null ? (Math.random() * 2 ** 32) >>> 0 : opts.seed);
      this.setScenario(opts.scenario || 'normal');
      const gap = gauss(this.rng) * (this.sc.vol / 400) + this.sc.drift / 400;
      this.fair = Math.log(market.prev) + gap;
      this.bandar = [];
      this.histT = -1e9;
      this.steps = 0;
    }
    setScenario(key) { this.key = SCENARIOS[key] ? key : 'normal'; this.sc = SCENARIOS[this.key]; }

    fairIdx() { const x = Math.exp(this.fair), b = bandOf(x); return b.i0 + (x - b.lo) / b.tick; }
    midIdx() {
      const bb = this.m.bids.best(), bo = this.m.offers.best();
      if (bb !== null && bo !== null) return (priceIndex(bb) + priceIndex(bo)) / 2;
      if (bb !== null) return priceIndex(bb) + 0.5;
      if (bo !== null) return priceIndex(bo) - 0.5;
      return this.m.last !== null ? priceIndex(this.m.last) : this.fairIdx();
    }
    clampP(p) { const L = this.m.limits; return Math.max(L.arb, Math.min(L.ara, p)); }
    activity() {
      const t = this.m.clock;
      return 1 + 1.1 * Math.exp(-Math.max(0, t - H(9)) / 1500) + 0.8 * Math.exp(-Math.max(0, H(15, 50) - t) / 1500);
    }
    isForeign(side) { const fb = this.sc.foreign; return this.rng() < 0.22 * (1 + (side === 'B' ? fb : -fb)); }

    step(dt) {
      const m = this.m;
      const ph = m.advanceTo(m.clock + dt);
      if (ph === 'CLOSED' || ph === 'BREAK') return ph;
      this.evolveFair(dt);
      if (isAuction(ph)) this.auctionFlow(dt); else this.continuousFlow(dt);
      this.cancelFlow(dt);
      m.scanWalls();
      m.scanLimit();
      if (m.last !== null && m.clock - this.histT >= 30) { m.history.push([m.clock, m.last]); this.histT = m.clock; }
      if (++this.steps % 200 === 0) m.live = m.live.filter((o) => !o.dead);
      return ph;
    }
    // Majukan sampai jam tertentu dengan langkah 0,5 detik (dipakai untuk pemanasan).
    runUntil(clock) { while (this.m.clock < clock && this.m.phase !== 'CLOSED') this.step(Math.min(0.5, clock - this.m.clock)); }

    evolveFair(dt) {
      const sc = this.sc, m = this.m, r = this.rng;
      const sig = sc.vol / 100 / Math.sqrt(19800);
      let x = this.fair + (sc.drift / 100 / 3600) * dt + sig * Math.sqrt(dt) * gauss(r);
      if (sc.revert) x -= sc.revert * (x - Math.log(m.prev)) * dt;
      if (sc.jump && r() < sc.jump * dt) x += (r() < 0.5 ? -1 : 1) * (0.03 + 0.05 * r());
      this.fair = clamp(x, Math.log(m.limits.arb) - 0.01, Math.log(m.limits.ara) + 0.01);
    }

    continuousFlow(dt) {
      const m = this.m, r = this.rng, sc = this.sc, act = this.activity();
      const gapT = this.fairIdx() - this.midIdx();
      const bias = Math.tanh(gapT / 1.3);
      const nT = poisson(r, BASE.taker * sc.taker * act * (1 + 0.5 * Math.abs(bias)) * dt);
      for (let i = 0; i < nT; i++) {
        const buy = r() < 0.5 + 0.46 * bias;
        const sweep = Math.abs(gapT) > 2 && r() < 0.35 ? 1 + geometric(r, 0.45) : r() < 0.06 ? 1 : 0;
        this.take(buy ? 'B' : 'S', lognormal(r, m.baseLot * 1.3, 1) * (1 + Math.abs(bias)), sweep, 'taker');
      }
      for (const side of ['B', 'S']) {
        const fill = this.m.side(side).depth(20) / (BASE.depth * sc.depth * m.baseLot);
        const n = poisson(r, BASE.lp * act * clamp(1.5 - fill, 0.08, 2.2) * dt);
        for (let i = 0; i < n; i++) this.provide(side, bias);
      }
      if (r() < BASE.bandar * sc.big * dt) this.bandarMove(bias);
      this.bandar = this.bandar.filter((b) => {
        if (b.o.dead) return false;
        if (m.clock >= b.until) { m.cancel(b.o); return false; }
        return true;
      });
    }

    take(side, lotRaw, extra, tag) {
      const m = this.m;
      const opp = side === 'B' ? m.offers.best() : m.bids.best();
      let p;
      if (opp === null) {
        const own = side === 'B' ? m.bids.best() : m.offers.best();
        p = own !== null ? own : m.last !== null ? m.last : m.prev;
      } else p = extra ? stepPrice(opp, side === 'B' ? extra : -extra) : opp;
      return m.submit(side, this.clampP(p), Math.max(1, Math.round(lotRaw)), this.isForeign(side), tag);
    }

    provide(side, bias) {
      const m = this.m, r = this.rng;
      const own = side === 'B' ? m.bids.best() : m.offers.best();
      const opp = side === 'B' ? m.offers.best() : m.bids.best();
      const dir = side === 'B' ? -1 : 1;
      const lean = side === 'B' ? bias : -bias;
      let p;
      if (own !== null && opp !== null && priceIndex(opp) - priceIndex(own) > 1 && r() < 0.3 + 0.3 * lean) p = stepPrice(own, -dir);
      else {
        const anchor = own !== null ? own : opp !== null ? stepPrice(opp, dir) : priceAt(Math.round(this.fairIdx()));
        p = stepPrice(anchor, dir * geometric(r, clamp(BASE.q - 0.1 * lean, 0.4, 0.85)));
      }
      if (opp !== null && (side === 'B' ? p >= opp : p <= opp)) p = stepPrice(opp, dir);
      if (p > m.limits.ara || p < m.limits.arb) return null;
      return m.submit(side, p, Math.max(1, Math.round(lognormal(r, m.baseLot * 2, 1.05))), this.isForeign(side), 'lp');
    }

    bandarMove(bias) {
      const m = this.m, r = this.rng, sc = this.sc;
      let side = sc.wallSide > 0 ? 'B' : sc.wallSide < 0 ? 'S' : r() < 0.5 ? 'B' : 'S';
      if (r() < 0.55) {
        const dir = side === 'B' ? -1 : 1;
        const own = side === 'B' ? m.bids.best() : m.offers.best();
        const opp = side === 'B' ? m.offers.best() : m.bids.best();
        const anchor = own !== null ? own : opp !== null ? stepPrice(opp, dir) : m.last || m.prev;
        const p = this.clampP(stepPrice(anchor, dir * (r() < 0.4 ? 0 : 1 + Math.floor(r() * 3))));
        const o = m.submit(side, p, Math.round(m.baseLot * (60 + 160 * r())), r() < 0.5, 'bandar');
        if (o && !o.dead) this.bandar.push({ o, until: m.clock + 120 + 780 * r() });
      } else {
        if (sc.wallSide === 0) side = bias > 0.15 ? 'B' : bias < -0.15 ? 'S' : r() < 0.5 ? 'B' : 'S';
        this.take(side, m.baseLot * (35 + 120 * r()), 1 + Math.floor(r() * 3), 'bandar');
      }
    }

    auctionFlow(dt) {
      const m = this.m, r = this.rng;
      const n = poisson(r, BASE.auction * dt);
      const fi = this.fairIdx(), lean = Math.tanh(this.sc.drift / 6) * 0.12;
      for (let i = 0; i < n; i++) {
        const side = r() < 0.5 + lean ? 'B' : 'S';
        const off = Math.round(gauss(r) * 2.2 + (side === 'B' ? -0.7 : 0.7));
        const p = this.clampP(priceAt(Math.round(fi + off)));
        m.submit(side, p, Math.max(1, Math.round(lognormal(r, m.baseLot * 1.6, 1.05))), this.isForeign(side), 'auction');
      }
    }

    cancelFlow(dt) {
      const m = this.m, r = this.rng;
      const n = poisson(r, m.live.length * BASE.cancel * dt);
      for (let i = 0; i < n; i++) {
        const o = m.randomLive(r, (x) => x.tag !== 'bandar');
        if (o) m.cancel(o);
      }
    }
  }

  return {
    LOT, MIN_PRICE, BANDS, tickSize, isValidPrice, floorTick, ceilTick, priceIndex, priceAt, stepPrice,
    arLimits, sessionPlan, phaseAt, PHASE_LABEL, isContinuous, isAuction, parseClock, baseLotFor, H,
    Market, Simulator, SCENARIOS, mulberry32,
  };
});
