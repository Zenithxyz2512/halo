# Palagan Saham

Versi saham IDX dari [Bitcoin Battlefield](https://newhedge.io/bitcoin/battlefield) milik Newhedge: order book
satu saham digambar sebagai medan tempur 3D. Antrean bid jadi pasukan banteng di kiri, antrean offer jadi pasukan
beruang di kanan, dan garis depannya adalah harga berjalan.

Isinya:

| Berkas | Isi |
|---|---|
| `index.html` | Halaman utama: medan 3D (Three.js), order book, running trade, ringkasan, kronik |
| `engine.js` | Aturan BEI, order book prioritas harga-waktu, call auction, simulator pasar. Tanpa DOM, jalan di browser dan Node |
| `feed-server.js` | Contoh jembatan WebSocket untuk data live (bawaan: menyiarkan simulator) |
| `test/engine.test.js` | Tes aturan dan simulasi (`npm test`) |

## Cara menjalankan

- **Simulasi:** buka `index.html` (butuh internet untuk Three.js dari jsDelivr dan font Google). Bawaannya SRSN
  (Indo Acidatama) dengan harga acuan Rp132, penutupan 2 Okt 2026 menurut hasil pencarian web. Kode dan harga acuan
  bisa diganti dengan mengeklik kode saham.
- **Web:** versi ini juga ada di GitHub Pages repo ini: https://zenithxyz2512.github.io/halo/palagan-saham/
- **Mode feed:** `npm install`, lalu `node feed-server.js`, lalu buka `index.html?feed=ws://localhost:8787`.
  Opsi: `--code BBCA --prev 7500 --speed 5 --scenario akumulasi --port 8787`.
- **Tes:** `npm test`.

Kontrol: seret untuk memutar, cubit/gulir untuk zoom, klik ganda untuk reset kamera, spasi untuk jeda.
Klik kode saham untuk ganti kode dan harga acuan.

## Dari Bitcoin ke BEI

Bitcoin Battlefield memakai order book dan likuidasi dari bursa kripto yang datanya gratis. Saham IDX punya
struktur sendiri, jadi elemennya diterjemahkan begini:

| Bitcoin Battlefield | Palagan Saham |
|---|---|
| Harga BTC gabungan beberapa bursa | Harga transaksi terakhir di Pasar Reguler |
| Kedalaman order book jadi pasukan | Lot di antrean bid/offer per fraksi harga jadi bidak (skala 1-2-5, ditampilkan di legenda) |
| Penanda harga tiap $50 | Satu baris medan = satu fraksi; batas rentang fraksi (Rp200, Rp500, Rp2.000, Rp5.000) diberi garis kuningan |
| Buy/sell wall | Tembok: antrean minimal 6× median 10 level teratas. "Jebol" kalau habis dimakan transaksi, "ditarik" kalau dibatalkan |
| Large trades | Tembakan HAKA (dari kiri) dan HAKI (dari kanan); peluru besar untuk transaksi jumbo (kira-kira Rp500 juta ke atas) |
| Likuidasi | Tidak ada padanannya di pasar reguler. Diganti benteng ARA/ARB: harga tidak bisa lewat, antrean menumpuk di batas |
| — | Call auction pre-opening dan pre-closing: pasukan berbaur, lalu dieksekusi di satu harga (IEP) |
| — | Istirahat siang: gencatan senjata |
| — | Net asing (F/D) di ringkasan dan running trade |

## Aturan BEI yang dipakai

Dicek 5 Oktober 2026 lewat pencarian web. Artikel aslinya tidak bisa dibuka dari lingkungan tempat proyek ini
dibuat (diblokir proxy), jadi yang dipakai adalah ringkasan hasil pencarian dari beberapa media yang isinya saling
cocok. Silakan cek ulang ke sumbernya sebelum dipakai untuk hal penting.

| Aturan | Nilai di `engine.js` | Sumber (hasil pencarian) |
|---|---|---|
| Satuan perdagangan | 1 lot = 100 lembar | [Stockbit Snips](https://snips.stockbit.com/investasi/1-lot-saham-berapa-lembar-ini-aturan-bei-dan-cara-menghitung-modalnya) |
| Harga minimum | Rp1, berlaku 28 Sep 2026 (sebelumnya Rp50) | [Kontan](https://investasi.kontan.co.id/news/berlaku-batas-minimum-harga-saham-turun-ke-rp-1-cek-saham-harga-di-bawah-rp-50), [Antara](https://www.antaranews.com/berita/5751471/bei-harga-saham-terendah-rp1-berlaku-efektif-mulai-28-september-2026) |
| Fraksi harga | <200: Rp1 · 200–<500: Rp2 · 500–<2.000: Rp5 · 2.000–<5.000: Rp10 · ≥5.000: Rp25 | [Fortune IDN](https://www.fortuneidn.com/market/bei-tetapkan-harga-minimum-saham-rp1-mulai-28-september-2026-d7w02-00-lflgw-ln9l43) |
| ARA | Rp1–10: Rp1 · Rp11–200: 35% · >200–5.000: 25% · >5.000: 20% | [Bloomberg Technoz](https://www.bloombergtechnoz.com/detail-news/122260/bei-turunkan-minimum-harga-saham-jadi-rp1-auto-rejection-berubah) |
| ARB | Rp1–10: Rp1 · di atas Rp10: 15% sampai 31 Des 2026; mulai 1 Jan 2027 sama dengan ARA | [Katadata](https://katadata.co.id/finansial/bursa/6ab10d458e4d5/bei-ubah-aturan-auto-rejection-batas-arb-makin-lebar-jadi-35-mulai-2027) |
| Jadwal | Pre-opening 08:45 · Sesi 1 09:00–12:00 (Jumat 11:30) · Sesi 2 13:30–15:50 (Jumat 14:00) · Pre-closing 15:50–16:00 | [Pluang](https://pluang.com/akademi/berita-analisis/jam-bursa-saham-indonesia), [Bloomberg Technoz](https://www.bloombergtechnoz.com/detail-news/119339/jam-trading-saham-cek-panduan-lengkap-bursa-indonesia-2026/2) |

Simulator mengikuti tanggal: ARB otomatis jadi simetris kalau tanggal simulasinya 2027 atau sesudahnya.

## Soal data live

Ini bagian yang menentukan apakah versi "beneran" bisa dibuat.

- Bitcoin Battlefield gampang karena bursa kripto membagikan order book, transaksi, dan likuidasi secara gratis lewat
  WebSocket publik. **BEI tidak punya API publik gratis untuk order book real-time.**
- Jalur resmi: [Layanan Data BEI](https://www.idx.co.id/id/produk/layanan-data-bei) (real-time, delayed, end-of-day)
  lewat Data Vendor terdaftar, dengan [daftar harga](https://www.idx.co.id/media/9649/idx-data-services-price-list-version-02-add-eod.pdf)
  dan deposit. Menurut ringkasan pencarian, produknya mencakup Order Book.
- Penyedia API pihak ketiga, misalnya [Invezgo](https://invezgo.com/id/data-api-saham-indonesia) dan
  [GOAPI](https://goapi.io/api-data-saham-indonesia/), mengklaim menyediakan data real-time termasuk order book.
  Belum dicoba di proyek ini; cek harga, cakupan, dan lisensi redistribusinya dulu.
- Jangan scraping aplikasi sekuritas (Stockbit, dll.) tanpa izin: melanggar ketentuan layanan dan bisa diputus kapan saja.
- Sumber gratis seperti Yahoo Finance hanya memberi harga dan volume tertunda, tanpa antrean. Itu pun tidak bisa
  dipakai otomatis: pada 5 Okt 2026, workflow GitHub Actions yang mencoba mengambil data per menit SRSN.JK ditolak
  Yahoo dengan HTTP 429 (Too Many Requests), termasuk saat memakai cookie dan crumb.

Begitu punya akses feed, halaman ini tinggal disambungkan: tulis adaptor di blok `SUMBER` pada `feed-server.js`
yang mengubah data vendor ke format di bawah. Halaman tidak perlu diubah.

### Format pesan WebSocket

Semua pesan berupa JSON; boleh juga array berisi beberapa pesan. Waktu `t`/`clock` berupa `"HH:MM:SS"` WIB
atau epoch milidetik.

```jsonc
// Wajib sekali di awal. prev = harga acuan (penutupan hari sebelumnya).
{"type":"hello","code":"BBCA","prev":7500,"date":"2026-10-05","clock":"08:45:00","phase":"PRE_OPEN"}

// Snapshot antrean, terbaik dulu: bids menurun, offers menaik. Baris = [harga, lot, freq opsional].
{"type":"book","bids":[[7475,1200,34],[7450,800,12]],"offers":[[7500,950,20],[7525,400,9]]}

// Transaksi. side opsional: B = HAKA, S = HAKI, A = lelang; kalau kosong ditebak dari antrean.
// buyer/seller opsional: F = asing, D = lokal (dipakai untuk net asing).
{"type":"trade","t":"09:00:01","price":7500,"lot":15,"side":"B","buyer":"F","seller":"D"}
{"type":"trades","items":[{"t":"09:00:01","price":7500,"lot":15}, {"t":"09:00:02","price":7475,"lot":3}]}

// Ganti sesi: PRE_OPEN, S1, BREAK, S2, PRE_CLOSE, CLOSED.
{"type":"phase","phase":"BREAK","clock":"12:00:00"}

// Opsional: angka resmi dari vendor menimpa hitungan halaman.
{"type":"stats","open":7475,"high":7525,"low":7450,"volume":120000,"value":910000000000,"freq":15000,"fbuy":120000000000,"fsell":90000000000}
```

Kirim `trade` sebelum `book` yang sudah memperhitungkannya, supaya halaman bisa membedakan tembok yang jebol
(dimakan transaksi) dari yang ditarik (dibatalkan).

## Cara kerja simulator

Agen-agen di `engine.js` mengikuti nilai wajar yang bergerak acak (plus drift sesuai skenario):

- **Penyedia likuiditas** memasang limit order di sekitar harga terbaik; ukurannya sekitar Rp15 juta per order (lognormal).
- **Taker** menghajar antrean (HAKA/HAKI) dengan arah yang condong ke selisih harga wajar dan harga berjalan.
- **Pemain besar** sesekali memasang tembok atau menyapu beberapa level sekaligus.
- **Pembatalan** acak membuat antrean tidak menumpuk selamanya.
- Pre-opening dan pre-closing memakai call auction: IEP dipilih dari volume terbanyak, lalu selisih terkecil,
  lalu yang paling dekat ke harga acuan.

Skenario: Normal, Akumulasi, Distribusi, Kejar ARA, Panik ARB, Gorengan. Semuanya ilustrasi perilaku pasar,
bukan tiruan saham tertentu dan bukan rekomendasi.

## Yang belum diverifikasi

- Isi artikel sumber aturan (hanya ringkasan hasil pencarian yang terbaca).
- Cara BEI membulatkan harga batas ARA/ARB yang tidak jatuh tepat di fraksi. Di sini ARA dibulatkan ke bawah dan
  ARB ke atas ke fraksi terdekat, karena order di luar persentase batas ditolak.
- Detail call auction BEI yang tidak dimodelkan, misalnya random closing dan aturan papan pemantauan khusus.
- Harga, cakupan, dan lisensi penyedia data yang disebut di atas.
- Hari libur bursa: simulator hanya melompati Sabtu dan Minggu.
