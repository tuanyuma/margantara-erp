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
