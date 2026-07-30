# Halo — prototipe onboarding asisten gizi

Prototipe web app onboarding gaya Gizi.ai / Cal AI: satu pertanyaan per layar,
berakhir di halaman rencana kalori harian yang dihitung dari data yang diisi.

Buka `index.html` di browser. Tidak ada build step, tidak ada dependency,
tidak ada backend — semua data disimpan di `localStorage` browser.

## Alur

1. Nama
2. Jenis kelamin
3. Tanggal lahir
4. Tinggi & berat badan
5. Tujuan (turun / jaga / naik)
6. Berat target — *dilewati kalau tujuannya "jaga"*
7. Kecepatan target (0,25–1 kg/minggu) — *dilewati kalau tujuannya "jaga"*
8. Level aktivitas
9. Preferensi makan
10. Hambatan (boleh pilih banyak / dilewati)
11. Layar "menyusun rencana"
12. **Halaman rencana** — target kalori, makro, BMI, estimasi tanggal target
13. **Beranda** — sisa kalori hari ini, progres makro, scan foto, catat makanan

## Scan makanan dari foto

Tombol "Scan makanan dari foto" mengirim foto ke model Claude dan mengembalikan
perkiraan kalori serta makro, yang bisa dikoreksi sebelum disimpan.

Butuh kunci API Anthropic milikmu sendiri (dari console.anthropic.com), diisi
lewat tombol gembok di beranda. Kunci disimpan di `localStorage` browser itu
saja dan dikirim langsung ke `api.anthropic.com` — tidak ada server perantara.
Karena kunci ada di browser, jangan pakai fitur ini di perangkat bersama.

Foto diperkecil ke sisi terpanjang 1024 px dan dikirim sebagai JPEG untuk
menghemat token gambar. Model: `claude-opus-5`, dengan `output_config.format`
JSON Schema supaya jawabannya selalu terstruktur.

**Fitur ini hanya jalan kalau halaman di-serve lewat http/https.** Dari
`file://` atau di dalam artifact claude.ai, browser memblokir permintaan
keluar dan appnya akan menampilkan pesan yang menjelaskan itu. Untuk mencoba
lokal:

```
python3 -m http.server 8000    # lalu buka http://localhost:8000
```

## Cara hitung

- **BMR** — Mifflin-St Jeor. Pilihan "lainnya" pakai rata-rata konstanta pria/wanita.
- **TDEE** — BMR × faktor aktivitas (1,2 / 1,375 / 1,55 / 1,725).
- **Target kalori** — TDEE ± (kecepatan × 7700 kkal) / 7, dibatasi minimum
  1200 kkal (wanita), 1500 kkal (pria), 1350 kkal (lainnya). Kalau target kena
  batas ini, halaman rencana memberi peringatan dan menghitung ulang estimasi
  tanggal dari laju yang sebenarnya tercapai, bukan yang diminta.
- **Protein** — 2,0 g/kg saat defisit, 1,8 g/kg saat surplus, 1,6 g/kg saat
  maintenance (berat dibatasi 120 kg untuk perhitungan).
- **Lemak** — 25% dari total kalori. **Karbo** — sisanya.

Angka-angka ini estimasi, bukan nasihat medis.

## Penyimpanan

| Key | Isi |
| --- | --- |
| `halo.profile.v1` | Jawaban onboarding + rencana |
| `halo.log.v1` | Catatan makanan per tanggal |
| `halo.apikey.v1` | Kunci API Anthropic untuk scan foto |

"Atur ulang profil" di beranda menghapus profil dan mengulang onboarding
(catatan makanan tetap tersimpan).
