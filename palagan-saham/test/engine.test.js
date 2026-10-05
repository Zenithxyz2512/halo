// Jalankan: node --test palagan-saham/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../engine.js');

test('fraksi harga per rentang', () => {
  const cases = [[1, 1], [199, 1], [200, 2], [498, 2], [500, 5], [1995, 5], [2000, 10], [4990, 10], [5000, 25], [9025, 25]];
  for (const [p, t] of cases) assert.equal(P.tickSize(p), t, `fraksi ${p}`);
  assert.ok(P.isValidPrice(5000) && !P.isValidPrice(5010) && !P.isValidPrice(201) && P.isValidPrice(4990));
});

test('langkah harga melintasi batas fraksi', () => {
  assert.equal(P.stepPrice(4990, 1), 5000);
  assert.equal(P.stepPrice(5000, -1), 4990);
  assert.equal(P.stepPrice(199, 1), 200);
  assert.equal(P.stepPrice(200, -1), 199);
  assert.equal(P.stepPrice(500, -1), 498);
  assert.equal(P.stepPrice(2000, -1), 1995);
  assert.equal(P.stepPrice(1, -1), 1);
});

test('indeks tangga harga bolak-balik', () => {
  let prev = -1;
  for (let p = 1; p <= 20000; p++) {
    if (!P.isValidPrice(p)) continue;
    const i = P.priceIndex(p);
    assert.equal(i, prev + 1, `indeks berurutan di ${p}`);
    assert.equal(P.priceAt(i), p);
    prev = i;
  }
});

test('batas auto rejection periode 28 Sep–31 Des 2026', () => {
  const d = '2026-10-05';
  const cases = [
    [1, 2, 1], [10, 11, 9], [100, 135, 85], [200, 270, 170], [1000, 1250, 850],
    [4850, 6050, 4130], [5000, 6250, 4250], [5025, 6025, 4280], [9000, 10800, 7650],
  ];
  for (const [ref, ara, arb] of cases) {
    const L = P.arLimits(ref, d);
    assert.equal(L.ara, ara, `ARA ${ref}`);
    assert.equal(L.arb, arb, `ARB ${ref}`);
    assert.ok(P.isValidPrice(L.ara) && P.isValidPrice(L.arb));
  }
});

test('ARB simetris mulai 1 Januari 2027', () => {
  assert.equal(P.arLimits(9000, '2027-01-04').arb, 7200);
  assert.equal(P.arLimits(1000, '2027-01-04').arb, 750);
  assert.equal(P.arLimits(100, '2027-01-04').arb, 65);
});

test('jadwal sesi Senin–Kamis dan Jumat', () => {
  const mon = P.sessionPlan(1), fri = P.sessionPlan(5), H = P.H;
  assert.equal(P.phaseAt(mon, H(8, 50)), 'PRE_OPEN');
  assert.equal(P.phaseAt(mon, H(11, 59)), 'S1');
  assert.equal(P.phaseAt(mon, H(12, 30)), 'BREAK');
  assert.equal(P.phaseAt(mon, H(13, 30)), 'S2');
  assert.equal(P.phaseAt(fri, H(11, 45)), 'BREAK');
  assert.equal(P.phaseAt(fri, H(13, 45)), 'BREAK');
  assert.equal(P.phaseAt(fri, H(14)), 'S2');
  assert.equal(P.phaseAt(mon, H(15, 55)), 'PRE_CLOSE');
  assert.equal(P.phaseAt(mon, H(16, 1)), 'CLOSED');
});

function market(clock) {
  return new P.Market({ code: 'TEST', prev: 1000, date: '2026-10-05', dow: 1, clock });
}

test('pencocokan harga-waktu, sisa order antre', () => {
  const m = market(P.H(10));
  const a = m.submit('S', 1005, 10, false);
  const b = m.submit('S', 1005, 20, true);
  m.submit('S', 1010, 50, false);
  m.submit('B', 1010, 45, false, 'taker');
  // a habis duluan (lebih awal), lalu b, lalu 15 lot dari level 1010
  assert.ok(a.dead && b.dead);
  assert.equal(m.offers.best(), 1010);
  assert.equal(m.offers.levels[0].lot, 35);
  assert.equal(m.volume, 45);
  assert.equal(m.haka, 45);
  assert.equal(m.last, 1010);
  assert.equal(m.fsell, 20 * 100 * 1005);
  const { trades } = m.drain();
  assert.deepEqual(trades.map((t) => [t.price, t.lot, t.side]), [[1005, 30, 'B'], [1010, 15, 'B']]);
  // HAKI menyisakan order jual di harga limitnya
  m.submit('B', 995, 40, false);
  m.submit('S', 995, 60, false, 'taker');
  assert.equal(m.offers.best(), 995);
  assert.equal(m.offers.levels[0].lot, 20);
  assert.equal(m.haki, 40);
});

test('order ditolak: fraksi salah, lewat ARA/ARB, jam istirahat', () => {
  const m = market(P.H(10));
  assert.equal(m.submit('B', 1001, 1), null);
  assert.equal(m.submit('B', 1255, 1), null);
  assert.equal(m.submit('S', 845, 1), null);
  assert.ok(m.submit('B', 1250, 1));
  assert.ok(m.submit('S', 850, 1));
  const n = market(P.H(12, 10));
  assert.equal(n.submit('B', 1000, 1), null);
});

test('call auction: IEP volume terbanyak lalu dieksekusi di satu harga', () => {
  const m = market(P.H(8, 50));
  m.submit('B', 1010, 100); m.submit('B', 1000, 50);
  m.submit('S', 990, 60); m.submit('S', 1005, 80);
  // di pre-opening tidak ada transaksi
  assert.equal(m.volume, 0);
  const iep = m.computeIEP();
  assert.equal(iep.p, 1005);
  assert.equal(iep.v, 100);
  m.advanceTo(P.H(9, 0, 1));
  assert.equal(m.phase, 'S1');
  assert.equal(m.open, 1005);
  assert.equal(m.volume, 100);
  assert.ok(m.bids.best() < m.offers.best());
});

for (const key of Object.keys(P.SCENARIOS)) {
  test(`simulasi sehari penuh tetap sah: ${key}`, () => {
    const m = new P.Market({ code: 'SIMU', prev: 4850, date: '2026-10-05', dow: 1 });
    const sim = new P.Simulator(m, { scenario: key, seed: 7 });
    let vol = 0, freq = 0, phases = [];
    let lastPhase = m.phase;
    while (m.phase !== 'CLOSED') {
      sim.step(0.5);
      const { trades, events } = m.drain();
      for (const t of trades) { vol += t.lot; assert.ok(P.isValidPrice(t.price)); assert.ok(t.price <= m.limits.ara && t.price >= m.limits.arb); }
      for (const e of events) if (e.kind === 'phase') phases.push(e.to);
      if (P.isContinuous(m.phase)) {
        const bb = m.bids.best(), bo = m.offers.best();
        if (bb !== null && bo !== null) assert.ok(bb < bo, `book bersilang ${bb}/${bo} @${m.clock}`);
      }
      if (m.phase !== lastPhase) lastPhase = m.phase;
      if (sim.steps % 97 === 0) {
        for (const S of [m.bids, m.offers]) {
          for (let i = 0; i < S.levels.length; i++) {
            const L = S.levels[i];
            assert.ok(P.isValidPrice(L.p) && L.p <= m.limits.ara && L.p >= m.limits.arb);
            assert.equal(L.lot, L.q.reduce((s, o) => s + o.lot, 0));
            if (i) assert.ok(S.isBid ? L.p < S.levels[i - 1].p : L.p > S.levels[i - 1].p);
          }
        }
      }
    }
    assert.deepEqual(phases, ['S1', 'BREAK', 'S2', 'PRE_CLOSE', 'CLOSED']);
    assert.equal(vol, m.volume);
    assert.ok(m.close >= m.low && m.close <= m.high);
    assert.ok(m.volume > 0 && m.freq > 0);
  });
}

test('mode jangkar: harga simulasi menempel ke harga asli dan ikut berpindah', () => {
  const m = new P.Market({ code: 'SRSN', prev: 132, date: '2026-10-05', dow: 1, clock: P.H(10) });
  const sim = new P.Simulator(m, { seed: 11 });
  sim.setAnchor({ price: 143, rate: 0.5, median: 300 });
  let far = 0, n = 0;
  while (m.clock < P.H(11)) {
    sim.step(0.5);
    m.drain();
    if (m.clock > P.H(10, 10) && m.last !== null) { n++; if (Math.abs(P.priceIndex(m.last) - P.priceIndex(143)) > 3) far++; }
  }
  assert.ok(n > 1000 && far / n < 0.05, `harga menjauh dari jangkar ${far}/${n}`);
  sim.setAnchor({ price: 138, rate: 0.5, median: 300 });
  sim.runUntil(P.H(11, 10));
  assert.ok(Math.abs(P.priceIndex(m.last) - P.priceIndex(138)) <= 3, `tidak ikut pindah: ${m.last}`);
  assert.ok(P.indexToPriceCont(P.priceIndex(4990) + 0.5) === 4995);
});
