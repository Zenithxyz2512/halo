# Data harga untuk Palagan Saham

Branch ini diisi otomatis oleh workflow **Rekam harga SRSN** (`.github/workflows/rekam-srsn.yml` di branch `main`).
Tiap 10 menit pada jam bursa workflow itu mengambil candle harga dari Yahoo Finance (tertunda sekitar 10 menit)
dan menyimpannya di sini. Palagan Saham membacanya untuk mode Live dan untuk memutar ulang hari-hari sebelumnya.

- `SRSN/index.json`: daftar tanggal yang tersedia.
- `SRSN/<tanggal>.json`: satu hari bursa.

```json
{
  "code": "SRSN", "date": "2026-10-02", "prev": 131, "step": 60, "src": "Yahoo Finance",
  "day": [132, 141, 129, 132, 350814500],
  "bars": [["09:00", 133, 133, 132, 132, 0], ["09:01", 132, 132, 131, 132, 756300]]
}
```

- `prev`: harga acuan, yaitu penutupan hari bursa sebelumnya.
- `step`: lebar candle dalam detik (60 untuk 7 hari terakhir, 300 untuk data yang lebih lama).
- `day`: open, high, low, close, volume (lembar) harian.
- `bars`: jam WIB awal candle, open, high, low, close, volume (lembar). Menit tanpa transaksi tidak dicatat.
  Candle 16:00 adalah lelang penutupan; candle sesudahnya adalah post-trading di harga penutupan.

Data Yahoo Finance tidak resmi dan bisa berbeda sedikit dari data BEI (open kadang selisih satu fraksi,
volume candle sedikit lebih kecil dari volume harian). Workflow menimpa commit hari yang sama supaya riwayat
branch ini cukup satu commit per hari bursa.
