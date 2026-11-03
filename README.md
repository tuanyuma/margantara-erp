# Margantara ERP - WebApp Monitoring Sales, POS & Absensi Toko

Aplikasi ERP modern untuk monitoring sales lapangan, POS kasir toko, absensi berbasis GPS, dan rekap transaksi dengan arsitektur **Hybrid Multi-Cloud** (Google Apps Script + Supabase PostgreSQL + Vercel Edge Hosting).

---

## ⚡ Arsitektur Hybrid

```
                      ┌──────────────────────────────────────┐
                      │    Pengguna (Browser / HP Sales)     │
                      └──────────────────┬───────────────────┘
                                         │
                        Buka Website Cepat (Edge CDN < 0.5s)
                                         │
                                         ▼
                             ┌───────────────────────┐
                             │    VERCEL FRONTEND    │
                             │ (Static /dist bundle) │
                             └───────────┬───────────┘
                                         │
                        Universal REST API Bridge (CORS-Safe)
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │       GOOGLE APPS SCRIPT BACKEND      │
                     │ (doPost Endpoint - Business Engine)   │
                     └───────────┬───────────────┬───────────┘
                                 │               │
                 Query Realtime  │               │ Dual-Write Backup
              (PostgREST REST API)               │ (SpreadsheetApp)
                                 │               │
                                 ▼               ▼
                     ┌──────────────────────┐  ┌──────────────────────┐
                     │ SUPABASE POSTGRESQL  │  │ GOOGLE SPREADSHEET   │
                     │  (Primary Database)  │  │  (Secondary Backup)  │
                     └──────────────────────┘  └──────────────────────┘
```

---

## 🗄️ Panduan Setup & Migrasi Supabase (Skill: /migrasi-to-supabase)

### Langkah 1: Eksekusi SQL di Supabase
1. Buka [Supabase Dashboard](https://supabase.com/dashboard) dan pilih project Anda.
2. Di menu samping kiri, klik **SQL Editor**.
3. Buka file [`SETUP_SUPABASE.sql`](file:///D:/1.%20CUSTOM%20WEBAPP/MARGANTARA%20-%20KLIEN/SETUP_SUPABASE.sql), salin seluruh isinya, lalu tempel (paste) ke SQL Editor.
4. Klik tombol **Run** (atau tekan `Ctrl + Enter`).
5. Pastikan muncul status `Success. No rows returned`. Seluruh 10 tabel, sequences, generator ID prefix, RLS policies, dan RPC Stored Procedures (`reserve_ids`, `gas_bulk_update`, `sync_sequences`) telah siap!

### Langkah 2: Konfigurasi Script Properties di Apps Script
1. Buka project Google Apps Script Anda.
2. Di menu kiri, buka **Project Settings** (ikon gerigi ⚙️).
3. Gulir ke bagian **Script Properties**, klik **Edit script properties**, lalu tambahkan:
   - `SUPABASE_URL`: `https://xxxxxxxxxxxx.supabase.co`
   - `SUPABASE_SERVICE_KEY`: *(Service Role Secret Key dari menu Project Settings > API di Supabase)*
   - `SUPABASE_ACTIVE`: `true`
4. Klik **Save script properties**.

*(Catatan: Anda juga bisa mengaturnya langsung dari menu **Pengaturan > Database & Cloud Sync** di web app).*

### Langkah 3: Migrasi Data Otomatis dari Spreadsheet ke Supabase (1-Klik)
1. Di editor Google Apps Script, pilih fungsi `migrasiSheetsKeSupabase` pada dropdown toolbar atas.
2. Klik tombol **Run** (▶).
3. Script akan membaca seluruh sheet secara bertahap (batch 200 baris), menormalisasi data, melakukan `UPSERT` idempoten, dan menyinkronkan sequence nomor ID (`sync_sequences`).
4. Pasang trigger Anti-Pause agar database Supabase Free Tier tidak tertidur dengan menjalankan fungsi `setupAntiPauseTrigger`.

---

## 🚀 Panduan Deploy ke Vercel via GitHub

### 1. Buat Repositori Baru di GitHub
1. Buka [github.com/new](https://github.com/new).
2. Beri nama repositori (misalnya: `margantara-erp`).
3. Pilih **Private** atau **Public**, lalu klik **Create repository**.

### 2. Push Kode ke GitHub
Jalankan perintah berikut di terminal workspace ini:
```bash
git remote add origin https://github.com/USERNAME_ANDA/NAMA_REPOSITORI.git
git branch -M main
git push -u origin main
```

### 3. Hubungkan ke Vercel (1-Klik)
1. Buka [vercel.com](https://vercel.com) dan login dengan akun GitHub Anda.
2. Klik tombol **Add New...** > **Project**.
3. Cari dan pilih repositori `margantara-erp` yang baru saja Anda push.
4. Pada form konfigurasi:
   - **Framework Preset**: *Other*
   - **Build Command**: `node build.js` (Otomatis terisi dari `package.json`)
   - **Output Directory**: `dist` (Otomatis terisi dari `vercel.json`)
5. Klik **Deploy**!

Situs Anda akan aktif dalam hitungan detik dengan kecepatan tinggi dan sertifikat SSL gratis!

---

## 🛠️ Pengembangan Lokal

Jika Anda mengedit file-file partial seperti `Dashboard.html`, `Pos.html`, dll., jalankan perintah berikut untuk mengompilasi ulang bundle:

```bash
# Kompilasi ulang ke dist/index.html
npm run build

# Menjalankan preview lokal
npm start
```
