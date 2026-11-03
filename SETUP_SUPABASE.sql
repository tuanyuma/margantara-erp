-- ==============================================================================
-- SETUP_SUPABASE.sql
-- Skrip Setup & Migrasi Database PostgreSQL untuk Supabase
-- Aplikasi: Margantara ERP (Monitoring Sales, POS & Absensi Toko)
-- Standar Arsitektur: Skill /migrasi-to-supabase (Hybrid Pattern)
--
-- Sifat: 100% IDEMPOTEN (Aman dijalankan berulang kali tanpa merusak data)
-- ==============================================================================
-- CARA MENJALANKAN DI SUPABASE:
-- 1. Buka Dashboard Supabase (https://supabase.com/dashboard) -> Pilih Project Anda.
-- 2. Di menu navigasi sebelah kiri, klik icon "SQL Editor".
-- 3. Klik "New query", lalu salin (copy) dan tempel (paste) seluruh isi file ini.
-- 4. Klik tombol "Run" (atau tekan Ctrl + Enter).
-- 5. Periksa tab "Results" di bawah: pastikan muncul pesan "Success".
-- ==============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. EXTENSIONS & SEQUENCE GENERATOR (PREF-ID ENGINE)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sequence untuk masing-masing tabel yang memerlukan ID berurutan
CREATE SEQUENCE IF NOT EXISTS seq_users START WITH 1;
CREATE SEQUENCE IF NOT EXISTS seq_outlet START WITH 1;
CREATE SEQUENCE IF NOT EXISTS seq_absensi START WITH 1;
CREATE SEQUENCE IF NOT EXISTS seq_kunjungan START WITH 1;
CREATE SEQUENCE IF NOT EXISTS seq_transaksi START WITH 1;
CREATE SEQUENCE IF NOT EXISTS seq_transaksi_detail START WITH 1;
CREATE SEQUENCE IF NOT EXISTS seq_stok_sales START WITH 1;

-- Fungsi Generator ID ber-prefix dengan padding angka dinamis
CREATE OR REPLACE FUNCTION generate_prefixed_id(prefix text, seq_name text, pad_len int DEFAULT 4)
RETURNS text AS $$
DECLARE
  next_val bigint;
BEGIN
  next_val := nextval(seq_name);
  RETURN prefix || '-' || LPAD(next_val::text, pad_len, '0');
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. DEFINISI TABEL UTAMA (CREATE TABLE IF NOT EXISTS)
-- ──────────────────────────────────────────────────────────────────────────────

-- TABEL 1: CONFIG
CREATE TABLE IF NOT EXISTS public.config (
  key text PRIMARY KEY,
  value text,
  keterangan text,
  updated_at timestamptz DEFAULT now()
);

-- TABEL 2: USERS
CREATE TABLE IF NOT EXISTS public.users (
  user_id text PRIMARY KEY DEFAULT generate_prefixed_id('USR', 'seq_users', 3),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  nama_lengkap text NOT NULL,
  role text NOT NULL,
  kode_wilayah text NOT NULL DEFAULT 'SEMUA',
  nomor_hp text,
  status text NOT NULL DEFAULT 'Aktif',
  tanggal_dibuat text DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- TABEL 3: WILAYAH
CREATE TABLE IF NOT EXISTS public.wilayah (
  kode_wilayah text PRIMARY KEY,
  nama_wilayah text NOT NULL,
  nama_kabupaten text,
  provinsi text,
  keterangan text,
  link_google_maps_kantor text,
  latitude_kantor numeric,
  longitude_kantor numeric,
  radius_absensi numeric DEFAULT 100,
  nama_bank text,
  nomor_rekening text,
  atas_nama_rekening text,
  qris_image_url text,
  status text NOT NULL DEFAULT 'Aktif',
  tanggal_dibuat text DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- TABEL 4: PRODUK
CREATE TABLE IF NOT EXISTS public.produk (
  kode_produk text PRIMARY KEY,
  nama_produk text NOT NULL,
  singkatan text,
  isi_per_bal numeric DEFAULT 200,
  kategori text DEFAULT 'ROKOK',
  harga_jual numeric DEFAULT 0,
  satuan text DEFAULT 'Bks',
  stok_awal numeric DEFAULT 0,
  target_bulanan numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'Aktif',
  tanggal_dibuat text DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- TABEL 5: OUTLET
CREATE TABLE IF NOT EXISTS public.outlet (
  kode_outlet text PRIMARY KEY DEFAULT generate_prefixed_id('OTL', 'seq_outlet', 3),
  nama_toko text NOT NULL,
  nama_pemilik text,
  nomor_hp text,
  alamat text,
  kode_wilayah text,
  hari_kunjungan text,
  link_google_maps text,
  latitude numeric,
  longitude numeric,
  radius_meter numeric DEFAULT 50,
  bisa_untuk_absensi text DEFAULT 'Tidak',
  status_verifikasi text DEFAULT 'Pending',
  didaftarkan_oleh text,
  diverifikasi_oleh text,
  tanggal_dibuat text DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- TABEL 6: ABSENSI
CREATE TABLE IF NOT EXISTS public.absensi (
  id_absensi text PRIMARY KEY DEFAULT generate_prefixed_id('ABS', 'seq_absensi', 4),
  id_sales text NOT NULL,
  tanggal text NOT NULL,
  jam_masuk text,
  jam_pulang text,
  latitude_masuk numeric,
  longitude_masuk numeric,
  latitude_pulang numeric,
  longitude_pulang numeric,
  jarak_masuk_meter numeric,
  jarak_pulang_meter numeric,
  status_lokasi text,
  foto_selfie_masuk text,
  foto_selfie_pulang text,
  created_at timestamptz DEFAULT now()
);

-- TABEL 7: KUNJUNGAN
CREATE TABLE IF NOT EXISTS public.kunjungan (
  id_kunjungan text PRIMARY KEY DEFAULT generate_prefixed_id('KNJ', 'seq_kunjungan', 4),
  id_sales text NOT NULL,
  kode_outlet text NOT NULL,
  tanggal text NOT NULL,
  jam_kunjungan text,
  latitude numeric,
  longitude numeric,
  jarak_meter numeric,
  status_validasi text,
  foto_selfie text,
  foto_barang text,
  foto_display text,
  catatan_kunjungan text,
  stok_toko text,
  tanggal_dibuat text DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- TABEL 8: TRANSAKSI
CREATE TABLE IF NOT EXISTS public.transaksi (
  nomor_faktur text PRIMARY KEY DEFAULT generate_prefixed_id('TRX', 'seq_transaksi', 6),
  waktu_transaksi text NOT NULL,
  id_sales text NOT NULL,
  kode_outlet text NOT NULL,
  kode_wilayah text NOT NULL,
  total_item numeric DEFAULT 0,
  subtotal numeric DEFAULT 0,
  diskon numeric DEFAULT 0,
  total_akhir numeric DEFAULT 0,
  metode_pembayaran text DEFAULT 'TUNAI',
  status_pembayaran text DEFAULT 'LUNAS',
  catatan text,
  tanggal_dibuat text DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- TABEL 9: TRANSAKSI DETAIL
CREATE TABLE IF NOT EXISTS public.transaksi_detail (
  id_detail text PRIMARY KEY DEFAULT generate_prefixed_id('DTL', 'seq_transaksi_detail', 6),
  nomor_faktur text NOT NULL REFERENCES public.transaksi(nomor_faktur) ON DELETE CASCADE,
  kode_produk text NOT NULL,
  nama_produk text NOT NULL,
  harga_satuan numeric DEFAULT 0,
  qty numeric DEFAULT 0,
  satuan text DEFAULT 'Bks',
  subtotal numeric DEFAULT 0
);

-- TABEL 10: STOK SALES
CREATE TABLE IF NOT EXISTS public.stok_sales (
  id_permintaan text PRIMARY KEY DEFAULT generate_prefixed_id('REQ', 'seq_stok_sales', 4),
  tanggal text NOT NULL,
  id_sales text NOT NULL,
  kode_produk text NOT NULL,
  nama_produk text NOT NULL,
  satuan text DEFAULT 'Bks',
  qty_diminta numeric DEFAULT 0,
  qty_disetujui numeric DEFAULT 0,
  qty_terjual numeric DEFAULT 0,
  qty_retur numeric DEFAULT 0,
  sisa_stok_sales numeric DEFAULT 0,
  status text DEFAULT 'Pending',
  catatan text,
  disetujui_oleh text,
  waktu_request text,
  waktu_closing text
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. INDEXES UNTUK PERFORMA TINGGI (>8.500 OUTLET & JUTAAN TRANSAKSI)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_outlet_kode_wilayah ON public.outlet(kode_wilayah);
CREATE INDEX IF NOT EXISTS idx_outlet_status_verifikasi ON public.outlet(status_verifikasi);
CREATE INDEX IF NOT EXISTS idx_outlet_nama_toko ON public.outlet(nama_toko);

CREATE INDEX IF NOT EXISTS idx_transaksi_id_sales ON public.transaksi(id_sales);
CREATE INDEX IF NOT EXISTS idx_transaksi_kode_outlet ON public.transaksi(kode_outlet);
CREATE INDEX IF NOT EXISTS idx_transaksi_kode_wilayah ON public.transaksi(kode_wilayah);
CREATE INDEX IF NOT EXISTS idx_transaksi_waktu ON public.transaksi(waktu_transaksi);

CREATE INDEX IF NOT EXISTS idx_trx_detail_faktur ON public.transaksi_detail(nomor_faktur);
CREATE INDEX IF NOT EXISTS idx_trx_detail_produk ON public.transaksi_detail(kode_produk);

CREATE INDEX IF NOT EXISTS idx_kunjungan_sales ON public.kunjungan(id_sales);
CREATE INDEX IF NOT EXISTS idx_kunjungan_outlet ON public.kunjungan(kode_outlet);
CREATE INDEX IF NOT EXISTS idx_kunjungan_tanggal ON public.kunjungan(tanggal);

CREATE INDEX IF NOT EXISTS idx_absensi_sales_tgl ON public.absensi(id_sales, tanggal);

CREATE INDEX IF NOT EXISTS idx_stok_sales_user ON public.stok_sales(id_sales, status);

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. FUNGSI AUTENTIKASI & CONTEXT JWT (PUBLIC APP HELPERS)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.app_email()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    current_setting('request.jwt.claim.email', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'email')
  );
$$;

CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );
$$;

CREATE OR REPLACE FUNCTION public.app_user_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    current_setting('request.jwt.claim.sub', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
  );
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY (RLS) - PRINSIP UTAMA SKILL
--    - anon & authenticated: BACA SAJA (SELECT)
--    - service_role: HAK PENUH (ALL - SELECT, INSERT, UPDATE, DELETE)
-- ──────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl_name text;
  tables text[] := ARRAY[
    'config', 'users', 'wilayah', 'produk', 'outlet',
    'absensi', 'kunjungan', 'transaksi', 'transaksi_detail', 'stok_sales'
  ];
BEGIN
  FOREACH tbl_name IN ARRAY tables
  LOOP
    -- Aktifkan RLS
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl_name);

    -- Hapus policy lama jika ada agar bersih & idempoten
    EXECUTE format('DROP POLICY IF EXISTS "Allow anon read" ON public.%I;', tbl_name);
    EXECUTE format('DROP POLICY IF EXISTS "Allow authenticated read" ON public.%I;', tbl_name);
    EXECUTE format('DROP POLICY IF EXISTS "Allow service_role all" ON public.%I;', tbl_name);

    -- Buat policy baru: Baca cepat untuk anon & authenticated
    EXECUTE format('CREATE POLICY "Allow anon read" ON public.%I FOR SELECT TO anon USING (true);', tbl_name);
    EXECUTE format('CREATE POLICY "Allow authenticated read" ON public.%I FOR SELECT TO authenticated USING (true);', tbl_name);

    -- Buat policy baru: Akses penuh hanya untuk backend Apps Script via service_role key
    EXECUTE format('CREATE POLICY "Allow service_role all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);', tbl_name);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. RPC FUNCTIONS KHUSUS SERVER APPS SCRIPT (PL/pgSQL SECURITY DEFINER)
-- ──────────────────────────────────────────────────────────────────────────────

-- RPC 1: reserve_ids
-- Mengambil rentang ID terurut secara massal dan aman dari race condition
CREATE OR REPLACE FUNCTION public.reserve_ids(p_table text, p_n int)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prefix text;
  v_seq text;
  v_pad int;
  v_ids text[] := '{}';
  v_val bigint;
  i int;
BEGIN
  IF p_n <= 0 THEN
    RETURN v_ids;
  END IF;

  CASE LOWER(p_table)
    WHEN 'users' THEN v_prefix := 'USR'; v_seq := 'seq_users'; v_pad := 3;
    WHEN 'outlet' THEN v_prefix := 'OTL'; v_seq := 'seq_outlet'; v_pad := 3;
    WHEN 'absensi' THEN v_prefix := 'ABS'; v_seq := 'seq_absensi'; v_pad := 4;
    WHEN 'kunjungan' THEN v_prefix := 'KNJ'; v_seq := 'seq_kunjungan'; v_pad := 4;
    WHEN 'transaksi' THEN v_prefix := 'TRX'; v_seq := 'seq_transaksi'; v_pad := 6;
    WHEN 'transaksi_detail' THEN v_prefix := 'DTL'; v_seq := 'seq_transaksi_detail'; v_pad := 6;
    WHEN 'stok_sales' THEN v_prefix := 'REQ'; v_seq := 'seq_stok_sales'; v_pad := 4;
    ELSE
      RAISE EXCEPTION 'Tabel % tidak memiliki sequence prefix terdaftar', p_table;
  END CASE;

  FOR i IN 1..p_n LOOP
    v_val := nextval(v_seq);
    v_ids := array_append(v_ids, v_prefix || '-' || LPAD(v_val::text, v_pad, '0'));
  END LOOP;

  RETURN v_ids;
END;
$$;

-- RPC 2: gas_bulk_update
-- Melakukan update multi-baris secara dinamis dalam 1 transaksi (pengganti DB.updateBatch)
CREATE OR REPLACE FUNCTION public.gas_bulk_update(p_table text, p_key text, p_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row jsonb;
  v_updated_count int := 0;
  v_sql text;
  v_set text;
  v_col text;
  v_val text;
  v_key_val text;
BEGIN
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_key_val := v_row ->> p_key;
    IF v_key_val IS NOT NULL THEN
      v_set := '';
      FOR v_col, v_val IN SELECT * FROM jsonb_each_text(v_row - p_key)
      LOOP
        IF v_set <> '' THEN v_set := v_set || ', '; END IF;
        v_set := v_set || quote_ident(v_col) || ' = ' || quote_nullable(v_val);
      END LOOP;

      IF v_set <> '' THEN
        v_sql := 'UPDATE public.' || quote_ident(p_table) || ' SET ' || v_set ||
                 ' WHERE ' || quote_ident(p_key) || ' = ' || quote_literal(v_key_val);
        EXECUTE v_sql;
        v_updated_count := v_updated_count + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN v_updated_count;
END;
$$;

-- RPC 3: safe_extract_sequence_num
-- Helper aman untuk mengekstrak angka sequence sederhana tanpa overflow jika ID berupa timestamp
CREATE OR REPLACE FUNCTION public.safe_extract_sequence_num(val text)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  clean text;
BEGIN
  IF val IS NULL OR val = '' THEN
    RETURN 0;
  END IF;

  -- 1. Format standar PREFIX-ANGKA sederhana (contoh: OTL-001, OTL-8528, USR-005, ABS-0042)
  -- Maksimal 12 digit agar aman dari batas overflow bigint PostgreSQL
  clean := substring(val from '^[A-Za-z]+-([0-9]{1,12})$');
  IF clean IS NOT NULL AND length(clean) > 0 THEN
    RETURN clean::bigint;
  END IF;

  -- 2. Format angka murni tanpa prefix (contoh: '1', '2', '8528')
  IF val ~ '^[0-9]{1,12}$' THEN
    RETURN val::bigint;
  END IF;

  -- 3. Abaikan ID komposit/timestamp (contoh: ABS-20261022-171952-..., TRX-2026-10-...)
  RETURN 0;
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END;
$$;

-- RPC 4: sync_sequences
-- Menyelaraskan sequence ke nilai ID numerik tertinggi secara aman
CREATE OR REPLACE FUNCTION public.sync_sequences()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_max bigint;
  v_res jsonb := '{}'::jsonb;
BEGIN
  -- 1. seq_users
  SELECT COALESCE(MAX(public.safe_extract_sequence_num(user_id)), 0) INTO v_max FROM public.users;
  PERFORM setval('seq_users', GREATEST(v_max, 1));
  v_res := jsonb_set(v_res, '{seq_users}', to_jsonb(GREATEST(v_max, 1)));

  -- 2. seq_outlet
  SELECT COALESCE(MAX(public.safe_extract_sequence_num(kode_outlet)), 0) INTO v_max FROM public.outlet;
  PERFORM setval('seq_outlet', GREATEST(v_max, 1));
  v_res := jsonb_set(v_res, '{seq_outlet}', to_jsonb(GREATEST(v_max, 1)));

  -- 3. seq_absensi
  SELECT COALESCE(MAX(public.safe_extract_sequence_num(id_absensi)), 0) INTO v_max FROM public.absensi;
  PERFORM setval('seq_absensi', GREATEST(v_max, 1));
  v_res := jsonb_set(v_res, '{seq_absensi}', to_jsonb(GREATEST(v_max, 1)));

  -- 4. seq_kunjungan
  SELECT COALESCE(MAX(public.safe_extract_sequence_num(id_kunjungan)), 0) INTO v_max FROM public.kunjungan;
  PERFORM setval('seq_kunjungan', GREATEST(v_max, 1));
  v_res := jsonb_set(v_res, '{seq_kunjungan}', to_jsonb(GREATEST(v_max, 1)));

  -- 5. seq_transaksi
  SELECT COALESCE(MAX(public.safe_extract_sequence_num(nomor_faktur)), 0) INTO v_max FROM public.transaksi;
  PERFORM setval('seq_transaksi', GREATEST(v_max, 1));
  v_res := jsonb_set(v_res, '{seq_transaksi}', to_jsonb(GREATEST(v_max, 1)));

  -- 6. seq_transaksi_detail
  SELECT COALESCE(MAX(public.safe_extract_sequence_num(id_detail)), 0) INTO v_max FROM public.transaksi_detail;
  PERFORM setval('seq_transaksi_detail', GREATEST(v_max, 1));
  v_res := jsonb_set(v_res, '{seq_transaksi_detail}', to_jsonb(GREATEST(v_max, 1)));

  -- 7. seq_stok_sales
  SELECT COALESCE(MAX(public.safe_extract_sequence_num(id_permintaan)), 0) INTO v_max FROM public.stok_sales;
  PERFORM setval('seq_stok_sales', GREATEST(v_max, 1));
  v_res := jsonb_set(v_res, '{seq_stok_sales}', to_jsonb(GREATEST(v_max, 1)));

  RETURN v_res;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. SEED DATA DEFAULT (INSERT ON CONFLICT DO NOTHING)
--    Menyiapkan data awal jika project Supabase benar-benar baru
-- ──────────────────────────────────────────────────────────────────────────────

-- Default Config
INSERT INTO public.config (key, value, keterangan) VALUES
  ('Nama Aplikasi', 'TokoTrack Pro', 'Nama judul webapp pada header dan login screen'),
  ('Logo URL', 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png', 'URL gambar logo webapp (transparan/PNG)'),
  ('Nama Perusahaan', 'PT Mitra Niaga Distribusi', 'Nama instansi / bisnis resmi'),
  ('Alamat Kantor', 'Jl. Pemuda No. 45, Surabaya, Jawa Timur', 'Alamat base office utama'),
  ('Link Google Maps Kantor', 'https://maps.google.com/?q=-7.265432,112.748901', 'Link Google Maps titik lokasi kantor'),
  ('Latitude Kantor', '-7.265432', 'Titik koordinat latitude kantor untuk absensi'),
  ('Longitude Kantor', '112.748901', 'Titik koordinat longitude kantor untuk absensi'),
  ('Radius Default Kantor Meter', '100', 'Batas maksimal radius absensi (meter)'),
  ('Nama Bank', 'Bank BCA', 'Nama bank untuk pembayaran transfer pelanggan'),
  ('Nomor Rekening', '8735091234', 'Nomor rekening bank penerima'),
  ('Atas Nama Rekening', 'PT Mitra Niaga Distribusi', 'Nama pemilik rekening bank'),
  ('Versi Sistem', '3.0 - Professional', 'Versi aplikasi')
ON CONFLICT (key) DO NOTHING;

-- Default Users
INSERT INTO public.users (user_id, username, password_hash, nama_lengkap, role, kode_wilayah, nomor_hp, status) VALUES
  ('USR-001', 'owner', 'owner123', 'Budi Santoso (Owner)', 'Owner', 'SEMUA', '081234567890', 'Aktif'),
  ('USR-002', 'admin', 'admin123', 'Siti Rahma (Admin)', 'Admin', 'SEMUA', '081234567891', 'Aktif'),
  ('USR-003', 'sales1', 'sales123', 'Rahman Hakim (Sales)', 'Sales', 'SBY', '081234567892', 'Aktif'),
  ('USR-004', 'sales2', 'sales123', 'Deni Prasetyo (Sales)', 'Sales', 'SDA', '081234567893', 'Aktif'),
  ('USR-005', 'sales3', 'sales123', 'Anton Wibowo (Sales)', 'Sales', 'MLG', '081234567894', 'Aktif')
ON CONFLICT (username) DO NOTHING;

-- Default Wilayah
INSERT INTO public.wilayah (kode_wilayah, nama_wilayah, nama_kabupaten, provinsi, keterangan, link_google_maps_kantor, latitude_kantor, longitude_kantor, radius_absensi, nama_bank, nomor_rekening, atas_nama_rekening, status) VALUES
  ('SBY', 'Cabang Surabaya', 'Kota Surabaya', 'Jawa Timur', 'Area Surabaya Pusat, Timur, Barat, Utara, Selatan', 'https://maps.google.com/?q=-7.265432,112.748901', -7.265432, 112.748901, 100, 'Bank BCA', '8735091234', 'PT Mitra Niaga Distribusi SBY', 'Aktif'),
  ('SDA', 'Cabang Sidoarjo', 'Kabupaten Sidoarjo', 'Jawa Timur', 'Area Waru, Gedangan, Porong, Krian', 'https://maps.google.com/?q=-7.447890,112.718234', -7.447890, 112.718234, 100, 'Bank Mandiri', '1410098765432', 'PT Mitra Niaga Distribusi SDA', 'Aktif'),
  ('MLG', 'Cabang Malang', 'Kota & Kab. Malang', 'Jawa Timur', 'Area Malang Raya, Batu, Singosari', 'https://maps.google.com/?q=-7.978120,112.621450', -7.978120, 112.621450, 100, 'Bank BRI', '002101987654321', 'PT Mitra Niaga Distribusi MLG', 'Aktif'),
  ('LBR', 'Cabang Lombok Barat', 'Kabupaten Lombok Barat', 'Nusa Tenggara Barat', 'Area Gerung, Kediri, Narmada, Sekotong', 'https://maps.google.com/?q=-8.681234,116.123456', -8.681234, 116.123456, 100, 'Bank BCA', '2690877345', 'Novan Ardiansyah', 'Aktif'),
  ('LOTENG', 'Cabang Lombok Tengah', 'Kabupaten Lombok Tengah', 'Nusa Tenggara Barat', 'Area Praya, Pujut, Kopang, Jonggat', 'https://maps.google.com/?q=-8.710000,116.270000', -8.710000, 116.270000, 100, 'Bank BCA', '2690877345', 'Novan Ardiansyah', 'Aktif'),
  ('LTM', 'Cabang Lombok Timur', 'Kabupaten Lombok Timur', 'Nusa Tenggara Barat', 'Area Selong, Masbagik, Aikmel, Labuhan Haji', 'https://maps.google.com/?q=-8.650000,116.530000', -8.650000, 116.530000, 100, 'Bank BCA', '2690877345', 'Novan Ardiansyah', 'Aktif'),
  ('KLU', 'Cabang Lombok Utara', 'Kabupaten Lombok Utara', 'Nusa Tenggara Barat', 'Area Tanjung, Gangga, Kayangan, Bayan', 'https://maps.google.com/?q=-8.350000,116.160000', -8.350000, 116.160000, 100, 'Bank BCA', '2690877345', 'Novan Ardiansyah', 'Aktif')
ON CONFLICT (kode_wilayah) DO NOTHING;

-- Default Produk
INSERT INTO public.produk (kode_produk, nama_produk, singkatan, isi_per_bal, kategori, harga_jual, satuan, stok_awal, target_bulanan, status) VALUES
  ('PSD', 'Ps Djeram (PSK)', 'PSK', 200, 'ROKOK', 18000, 'Bks', 500, 200, 'Aktif'),
  ('PSF', 'Ps Filter (PSF)', 'PSF', 200, 'ROKOK', 19000, 'Bks', 400, 180, 'Aktif'),
  ('AGE', 'AGE', 'AGE', 200, 'ROKOK', 20000, 'Bks', 600, 250, 'Aktif'),
  ('ART', 'ARTI', 'ART', 200, 'ROKOK', 17500, 'Bks', 450, 190, 'Aktif'),
  ('PSE', 'Ps Exclusive (PSE)', 'PSE', 100, 'ROKOK', 21000, 'Bks', 350, 150, 'Aktif'),
  ('AAM', 'Arti Apel Madu', 'AAM', 100, 'ROKOK', 22000, 'Bks', 300, 120, 'Aktif'),
  ('PSMI', 'Ps Mild', 'MILD', 100, 'ROKOK', 18500, 'Bks', 400, 160, 'Aktif'),
  ('PSMGO', 'Ps Mangga', 'MANGGA', 100, 'ROKOK', 19500, 'Bks', 500, 200, 'Aktif'),
  ('PSPLR', 'Ps Purple', 'PURPLE', 100, 'ROKOK', 19500, 'Bks', 350, 140, 'Aktif'),
  ('PSWTM', 'Ps Watermelon', 'WT MELON', 100, 'ROKOK', 19500, 'Bks', 350, 140, 'Aktif'),
  ('PSAPL', 'Ps Apel', 'APEL', 100, 'ROKOK', 19500, 'Bks', 350, 140, 'Aktif'),
  ('KJJ', 'Kopi Josjis', 'KOPI JOSJIS', 200, 'ROKOK', 17000, 'Bks', 400, 170, 'Aktif')
ON CONFLICT (kode_produk) DO NOTHING;

-- Sinkronkan sequence pertama kali
SELECT public.sync_sequences();

-- SELESAI

