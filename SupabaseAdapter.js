/**
 * ==============================================================================
 * SUPABASE ADAPTER & DUAL DATABASE BRIDGE FOR GOOGLE APPS SCRIPT
 * Architecture: apps-script-hybrid-stack (Pattern B: GAS + Supabase)
 * ==============================================================================
 * Keamanan:
 * - Seluruh URL & API Key disimpan secara eksklusif di PropertiesService (Script Properties).
 * - TIDAK ADA penyimpanan kunci rahasia di dalam Google Spreadsheet.
 * - TIDAK ADA hardcode kredensial di dalam kode.
 * ==============================================================================
 */

// ─── 1. PENGELOLAAN KREDENSIAL SCRIPT PROPERTIES ──────────────────────────────

/**
 * Mengambil konfigurasi Supabase dari Script Properties.
 * @private
 */
function getSupabaseConfig_() {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  const key = String(props.getProperty('SUPABASE_KEY') || '').trim();
  const active = String(props.getProperty('SUPABASE_ACTIVE') || 'false').trim().toLowerCase() === 'true';

  return { url: url, key: key, active: active };
}

/**
 * Memeriksa apakah Supabase sedang aktif dan valid dikonfigurasi.
 * @returns {boolean}
 */
function isSupabaseActive() {
  const cfg = getSupabaseConfig_();
  return Boolean(cfg.active && cfg.url && cfg.key);
}

/**
 * Menyimpan konfigurasi Supabase ke dalam Script Properties (Aman & Terisolasi).
 * @param {string} url - Supabase Project URL (e.g. https://xxx.supabase.co)
 * @param {string} key - Supabase Anon atau Service Role Key
 * @returns {{ success: boolean, message: string }}
 */
function setSupabaseConfig(url, key) {
  if (!url || !key) {
    throw new Error('URL dan API Key Supabase wajib diisi.');
  }

  const cleanUrl = String(url).trim().replace(/\/+$/, '');
  const cleanKey = String(key).trim();

  // Uji koneksi terlebih dahulu sebelum mengaktifkan
  const test = testSupabaseConnection(cleanUrl, cleanKey);
  if (!test.success) {
    throw new Error('Gagal menghubungkan ke Supabase: ' + test.message);
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    'SUPABASE_URL': cleanUrl,
    'SUPABASE_KEY': cleanKey,
    'SUPABASE_ACTIVE': 'true'
  });

  return {
    success: true,
    message: 'Koneksi ke Supabase berhasil diverifikasi & disimpan aman di Script Properties!'
  };
}

/**
 * Menonaktifkan Supabase dan mengembalikan sistem ke mode Spreadsheet murni.
 */
function disconnectSupabase() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SUPABASE_ACTIVE', 'false');
  return {
    success: true,
    message: 'Koneksi Supabase dinonaktifkan. Sistem sekarang berjalan dengan database Google Sheets.'
  };
}

/**
 * Mengambil status publik koneksi Supabase untuk tampilan UI (Disamarkan/Masked).
 */
function getSupabasePublicStatus() {
  const cfg = getSupabaseConfig_();
  let maskedKey = '';
  if (cfg.key) {
    const len = cfg.key.length;
    if (len > 12) {
      maskedKey = cfg.key.substring(0, 6) + '••••••••••••' + cfg.key.substring(len - 4);
    } else {
      maskedKey = '••••••••••••';
    }
  }

  return {
    success: true,
    active: cfg.active && Boolean(cfg.url && cfg.key),
    url: cfg.url || '',
    keyMasked: maskedKey,
    hasKey: Boolean(cfg.key)
  };
}

/**
 * Menguji koneksi ke endpoint PostgREST Supabase.
 */
function testSupabaseConnection(url, key) {
  try {
    const targetUrl = url + '/rest/v1/';
    const response = UrlFetchApp.fetch(targetUrl, {
      method: 'get',
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key
      },
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      return { success: true, message: 'Koneksi aktif (HTTP ' + code + ')' };
    } else {
      const body = response.getContentText();
      return { 
        success: false, 
        message: 'HTTP ' + code + ': ' + (body.substring(0, 150) || 'Koneksi ditolak') 
      };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── 2. HTTP REST CLIENT (PostgREST) ──────────────────────────────────────────

/**
 * Eksekusi HTTP Fetch ke Supabase PostgREST.
 * @private
 */
function supabaseFetch_(path, options) {
  const cfg = getSupabaseConfig_();
  if (!cfg.url || !cfg.key) {
    throw new Error('Supabase belum dikonfigurasi di Script Properties.');
  }

  options = options || {};
  const fullUrl = cfg.url + path;

  const headers = {
    'apikey': cfg.key,
    'Authorization': 'Bearer ' + cfg.key,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation'
  };

  if (options.headers) {
    for (const h in options.headers) {
      headers[h] = options.headers[h];
    }
  }

  const fetchOptions = {
    method: options.method || 'get',
    headers: headers,
    muteHttpExceptions: true
  };

  if (options.payload) {
    fetchOptions.payload = JSON.stringify(options.payload);
  }

  const response = UrlFetchApp.fetch(fullUrl, fetchOptions);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('Supabase Error ' + code + ': ' + text);
  }

  return text ? JSON.parse(text) : null;
}

// ─── 3. OPERASI CRUD SUPABASE ────────────────────────────────────────────────

/**
 * Mengambil data dari Supabase PostgREST dengan dukungan Auto-Pagination.
 * Mampu membaca > 1.000 baris secara otomatis dan aman (mengatasi limit default 1000 baris Supabase).
 */
function supabaseSelect(table, options) {
  options = options || {};
  const targetLimit = (options.limit !== undefined && options.limit !== null) ? Number(options.limit) : null;
  const startOffset = options.offset ? Number(options.offset) : 0;
  const PAGE_SIZE = 1000;

  // Tentukan order stabil jika tidak disediakan agar pagination tidak acak/melompat
  let orderParam = options.order;
  if (!orderParam && typeof TABLE_MAPPINGS !== 'undefined') {
    for (const key in TABLE_MAPPINGS) {
      if (TABLE_MAPPINGS[key] && TABLE_MAPPINGS[key].tableName === table) {
        orderParam = TABLE_MAPPINGS[key].primaryKey + '.asc';
        break;
      }
    }
  }

  // Jika limit diminta <= 1000 dan tidak null, cukup 1 kali request
  if (targetLimit !== null && targetLimit <= PAGE_SIZE) {
    let path = '/rest/v1/' + table + '?select=' + encodeURIComponent(options.select || '*');
    if (options.filters) {
      for (const col in options.filters) {
        path += '&' + col + '=' + encodeURIComponent(options.filters[col]);
      }
    }
    if (orderParam) path += '&order=' + encodeURIComponent(orderParam);
    path += '&limit=' + targetLimit;
    if (startOffset > 0) path += '&offset=' + startOffset;

    const res = supabaseFetch_(path, { method: 'get' });
    return Array.isArray(res) ? res : [];
  }

  // Auto-pagination loop untuk mengambil data lengkap (>1000 baris atau seluruh tabel)
  let allRows = [];
  let currentOffset = startOffset;
  const maxToFetch = targetLimit !== null ? targetLimit : Infinity;

  while (allRows.length < maxToFetch) {
    const fetchLimit = Math.min(PAGE_SIZE, maxToFetch - allRows.length);
    let path = '/rest/v1/' + table + '?select=' + encodeURIComponent(options.select || '*');

    if (options.filters) {
      for (const col in options.filters) {
        path += '&' + col + '=' + encodeURIComponent(options.filters[col]);
      }
    }
    if (orderParam) path += '&order=' + encodeURIComponent(orderParam);
    path += '&limit=' + fetchLimit;
    if (currentOffset > 0) path += '&offset=' + currentOffset;

    const chunk = supabaseFetch_(path, { method: 'get' });
    if (!Array.isArray(chunk) || chunk.length === 0) {
      break;
    }

    allRows = allRows.concat(chunk);
    currentOffset += chunk.length;

    // Jika jumlah data yang didapat lebih sedikit dari yang diminta (fetchLimit), data di server sudah habis
    if (chunk.length < fetchLimit) {
      break;
    }
  }

  return allRows;
}

function supabaseInsert(table, payload) {
  return supabaseFetch_('/rest/v1/' + table, {
    method: 'post',
    payload: payload,
    prefer: 'return=representation'
  });
}

function supabaseUpsert(table, payload, onConflict) {
  const prefer = onConflict
    ? 'resolution=merge-duplicates,return=representation'
    : 'return=representation';

  let path = '/rest/v1/' + table;
  if (onConflict) {
    path += '?on_conflict=' + encodeURIComponent(onConflict);
  }

  return supabaseFetch_(path, {
    method: 'post',
    payload: payload,
    prefer: prefer
  });
}

function supabaseUpdate(table, payload, filters) {
  let path = '/rest/v1/' + table + '?';
  const filterParts = [];
  if (filters) {
    for (const col in filters) {
      filterParts.push(col + '=' + encodeURIComponent(filters[col]));
    }
  }
  path += filterParts.join('&');

  return supabaseFetch_(path, {
    method: 'patch',
    payload: payload,
    prefer: 'return=representation'
  });
}

function supabaseDelete(table, filters) {
  let path = '/rest/v1/' + table + '?';
  const filterParts = [];
  if (filters) {
    for (const col in filters) {
      filterParts.push(col + '=' + encodeURIComponent(filters[col]));
    }
  }
  path += filterParts.join('&');

  return supabaseFetch_(path, {
    method: 'delete',
    prefer: 'return=representation'
  });
}

// ─── 4. MAPPING SCHEMA: SHEET HEADERS <-> SUPABASE COLUMNS ────────────────────

const TABLE_MAPPINGS = {
  'CONFIG': {
    tableName: 'config',
    primaryKey: 'key',
    sheetPrimaryKey: 'Key',
    columns: {
      'Key': 'key',
      'Value': 'value',
      'Keterangan': 'keterangan'
    }
  },
  'USERS': {
    tableName: 'users',
    primaryKey: 'user_id',
    sheetPrimaryKey: 'User ID',
    columns: {
      'User ID': 'user_id',
      'Username': 'username',
      'Password Hash': 'password_hash',
      'Nama Lengkap': 'nama_lengkap',
      'Role': 'role',
      'Kode Wilayah': 'kode_wilayah',
      'Nomor HP': 'nomor_hp',
      'Status': 'status',
      'Tanggal Dibuat': 'tanggal_dibuat'
    }
  },
  'WILAYAH': {
    tableName: 'wilayah',
    primaryKey: 'kode_wilayah',
    sheetPrimaryKey: 'Kode Wilayah',
    columns: {
      'Kode Wilayah': 'kode_wilayah',
      'Nama Wilayah': 'nama_wilayah',
      'Nama Kabupaten': 'nama_kabupaten',
      'Provinsi': 'provinsi',
      'Keterangan': 'keterangan',
      'Link Google Maps Kantor': 'link_google_maps_kantor',
      'Latitude Kantor': 'latitude_kantor',
      'Longitude Kantor': 'longitude_kantor',
      'Radius Absensi': 'radius_absensi',
      'Nama Bank': 'nama_bank',
      'Nomor Rekening': 'nomor_rekening',
      'Atas Nama Rekening': 'atas_nama_rekening',
      'QRIS Image URL': 'qris_image_url',
      'Status': 'status',
      'Tanggal Dibuat': 'tanggal_dibuat'
    }
  },
  'PRODUK': {
    tableName: 'produk',
    primaryKey: 'kode_produk',
    sheetPrimaryKey: 'Kode Produk',
    columns: {
      'Kode Produk': 'kode_produk',
      'Nama Produk': 'nama_produk',
      'Singkatan': 'singkatan',
      'Isi Per Bal': 'isi_per_bal',
      'Kategori': 'kategori',
      'Harga Jual': 'harga_jual',
      'Satuan': 'satuan',
      'Stok Awal': 'stok_awal',
      'Target Bulanan': 'target_bulanan',
      'Status': 'status',
      'Tanggal Dibuat': 'tanggal_dibuat'
    }
  },
  'OUTLET': {
    tableName: 'outlet',
    primaryKey: 'kode_outlet',
    sheetPrimaryKey: 'Kode Outlet',
    columns: {
      'Kode Outlet': 'kode_outlet',
      'Nama Toko': 'nama_toko',
      'Nama Pemilik': 'nama_pemilik',
      'Nomor HP': 'nomor_hp',
      'Alamat': 'alamat',
      'Kode Wilayah': 'kode_wilayah',
      'Hari Kunjungan': 'hari_kunjungan',
      'Link Google Maps': 'link_google_maps',
      'Latitude': 'latitude',
      'Longitude': 'longitude',
      'Radius Meter': 'radius_meter',
      'Bisa Untuk Absensi': 'bisa_untuk_absensi',
      'Status Verifikasi': 'status_verifikasi',
      'Didaftarkan Oleh': 'didaftarkan_oleh',
      'Diverifikasi Oleh': 'diverifikasi_oleh',
      'Tanggal Dibuat': 'tanggal_dibuat'
    }
  },
  'ABSENSI': {
    tableName: 'absensi',
    primaryKey: 'id_absensi',
    sheetPrimaryKey: 'ID Absensi',
    columns: {
      'ID Absensi': 'id_absensi',
      'ID Sales': 'id_sales',
      'Tanggal': 'tanggal',
      'Jam Masuk': 'jam_masuk',
      'Jam Pulang': 'jam_pulang',
      'Latitude Masuk': 'latitude_masuk',
      'Longitude Masuk': 'longitude_masuk',
      'Latitude Pulang': 'latitude_pulang',
      'Longitude Pulang': 'longitude_pulang',
      'Jarak Masuk Meter': 'jarak_masuk_meter',
      'Jarak Pulang Meter': 'jarak_pulang_meter',
      'Status Lokasi': 'status_lokasi',
      'Foto Selfie Masuk': 'foto_selfie_masuk',
      'Foto Selfie Pulang': 'foto_selfie_pulang'
    }
  },
  'KUNJUNGAN': {
    tableName: 'kunjungan',
    primaryKey: 'id_kunjungan',
    sheetPrimaryKey: 'ID Kunjungan',
    columns: {
      'ID Kunjungan': 'id_kunjungan',
      'ID Sales': 'id_sales',
      'Kode Outlet': 'kode_outlet',
      'Tanggal': 'tanggal',
      'Jam Kunjungan': 'jam_kunjungan',
      'Latitude': 'latitude',
      'Longitude': 'longitude',
      'Jarak Meter': 'jarak_meter',
      'Status Validasi': 'status_validasi',
      'Foto Selfie': 'foto_selfie',
      'Foto Barang': 'foto_barang',
      'Foto Display': 'foto_display',
      'Catatan Kunjungan': 'catatan_kunjungan',
      'Stok Toko': 'stok_toko',
      'Tanggal Dibuat': 'tanggal_dibuat'
    }
  },
  'TRANSAKSI': {
    tableName: 'transaksi',
    primaryKey: 'nomor_faktur',
    sheetPrimaryKey: 'Nomor Faktur',
    columns: {
      'Nomor Faktur': 'nomor_faktur',
      'Waktu Transaksi': 'waktu_transaksi',
      'ID Sales': 'id_sales',
      'Kode Outlet': 'kode_outlet',
      'Kode Wilayah': 'kode_wilayah',
      'Total Item': 'total_item',
      'Subtotal': 'subtotal',
      'Diskon': 'diskon',
      'Total Akhir': 'total_akhir',
      'Metode Pembayaran': 'metode_pembayaran',
      'Status Pembayaran': 'status_pembayaran',
      'Catatan': 'catatan',
      'Tanggal Dibuat': 'tanggal_dibuat'
    }
  },
  'TRANSAKSI DETAIL': {
    tableName: 'transaksi_detail',
    primaryKey: 'id_detail',
    sheetPrimaryKey: 'ID Detail',
    columns: {
      'ID Detail': 'id_detail',
      'Nomor Faktur': 'nomor_faktur',
      'Kode Produk': 'kode_produk',
      'Nama Produk': 'nama_produk',
      'Harga Satuan': 'harga_satuan',
      'Qty': 'qty',
      'Satuan': 'satuan',
      'Subtotal': 'subtotal'
    }
  },
  'STOK_SALES': {
    tableName: 'stok_sales',
    primaryKey: 'id_permintaan',
    sheetPrimaryKey: 'ID Permintaan',
    columns: {
      'ID Permintaan': 'id_permintaan',
      'Tanggal': 'tanggal',
      'ID Sales': 'id_sales',
      'Kode Produk': 'kode_produk',
      'Nama Produk': 'nama_produk',
      'Satuan': 'satuan',
      'Qty Diminta': 'qty_diminta',
      'Qty Disetujui': 'qty_disetujui',
      'Qty Terjual': 'qty_terjual',
      'Qty Retur': 'qty_retur',
      'Sisa Stok Sales': 'sisa_stok_sales',
      'Status': 'status',
      'Catatan': 'catatan',
      'Disetujui Oleh': 'disetujui_oleh',
      'Waktu Request': 'waktu_request',
      'Waktu Closing': 'waktu_closing'
    }
  }
};

/**
 * Konversi objek baris dari format Sheet ke format kolom Supabase.
 */
function mapSheetRowToSupabase(sheetName, sheetRow) {
  const norm = String(sheetName || '').trim().toUpperCase();
  const mapping = TABLE_MAPPINGS[norm];
  if (!mapping) return sheetRow;

  const result = {};
  for (const sheetCol in mapping.columns) {
    const supaCol = mapping.columns[sheetCol];
    if (sheetRow[sheetCol] !== undefined) {
      let val = sheetRow[sheetCol];
      // Format nilai tanggal/null/number
      if (val === '-' || val === '') {
        val = null;
      }
      result[supaCol] = val;
    }
  }
  return result;
}

/**
 * Konversi objek baris dari Supabase ke format header Google Sheet.
 */
function mapSupabaseRowToSheet(sheetName, supaRow) {
  const norm = String(sheetName || '').trim().toUpperCase();
  const mapping = TABLE_MAPPINGS[norm];
  if (!mapping) return supaRow;

  const result = {};
  for (const sheetCol in mapping.columns) {
    const supaCol = mapping.columns[sheetCol];
    let val = supaRow[supaCol];
    if (val === null || val === undefined) {
      val = '';
    }
    result[sheetCol] = val;
  }
  return result;
}

// ─── 5. DUAL-DATABASE HYBRID DATA LAYER ───────────────────────────────────────

/**
 * Membaca data dengan prioritas: Supabase (jika aktif) -> Fallback ke Spreadsheet.
 * Mengembalikan array of objects dengan key header Google Sheet yang identik!
 */
function dbRead(sheetName, options) {
  const norm = String(sheetName || '').trim().toUpperCase();
  const mapping = TABLE_MAPPINGS[norm];

  if (isSupabaseActive() && mapping) {
    try {
      const supaRows = supabaseSelect(mapping.tableName, options);
      if (Array.isArray(supaRows)) {
        return supaRows.map(row => mapSupabaseRowToSheet(sheetName, row));
      }
    } catch (e) {
      Logger.log('[Dual-DB Fallback] Gagal membaca Supabase ' + sheetName + ': ' + e.message + '. Beralih ke Google Sheets.');
    }
  }

  // Fallback ke Google Sheets
  return getSheetData(sheetName);
}

/**
 * Menyimpan data baru (Insert) dengan sistem Dual-Database:
 * 1. Menulis ke Supabase (Realtime Primary)
 * 2. Mencadangkan (Dual-write) ke Google Sheets
 */
function dbInsert(sheetName, dataMap) {
  const norm = String(sheetName || '').trim().toUpperCase();
  const mapping = TABLE_MAPPINGS[norm];

  // 1. Tulis ke Supabase jika aktif
  if (isSupabaseActive() && mapping) {
    try {
      const supaPayload = mapSheetRowToSupabase(sheetName, dataMap);
      supabaseInsert(mapping.tableName, supaPayload);
    } catch (e) {
      Logger.log('[Dual-DB] Gagal insert ke Supabase (' + sheetName + '): ' + e.message);
      // Lanjutkan eksekusi agar backup ke Google Sheet tetap berjalan
    }
  }

  // 2. Selalu cadangkan ke Google Sheets
  try {
    const sheet = getSheetCaseInsensitive(sheetName);
    if (sheet) {
      appendRowByHeaderMap(sheet, dataMap);
    }
  } catch (errSheet) {
    Logger.log('[Dual-DB Backup] Gagal menulis ke Sheet: ' + errSheet.message);
  }
}

/**
 * Memperbarui baris data (Update) di Supabase dan mencadangkan ke Google Sheets.
 */
function dbUpdate(sheetName, primaryKeyVal, updateMap) {
  const norm = String(sheetName || '').trim().toUpperCase();
  const mapping = TABLE_MAPPINGS[norm];

  // 1. Update ke Supabase
  if (isSupabaseActive() && mapping) {
    try {
      const supaPayload = mapSheetRowToSupabase(sheetName, updateMap);
      const filters = {};
      filters[mapping.primaryKey] = 'eq.' + primaryKeyVal;
      supabaseUpdate(mapping.tableName, supaPayload, filters);
    } catch (e) {
      Logger.log('[Dual-DB] Gagal update Supabase (' + sheetName + '): ' + e.message);
    }
  }

  // 2. Update di Google Sheet
  try {
    const sheet = getSheetCaseInsensitive(sheetName);
    if (sheet) {
      const data = getSheetData(sheetName) || [];
      const pkHeader = mapping ? mapping.sheetPrimaryKey : 'ID';
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][pkHeader] || '').trim() === String(primaryKeyVal || '').trim()) {
          updateRowByHeaderMap(sheet, i + 2, updateMap);
          break;
        }
      }
    }
  } catch (errSheet) {
    Logger.log('[Dual-DB Backup] Gagal update Sheet: ' + errSheet.message);
  }
}

/**
 * Menghapus baris data (Delete) di Supabase dan Google Sheets.
 */
function dbDelete(sheetName, primaryKeyVal) {
  const norm = String(sheetName || '').trim().toUpperCase();
  const mapping = TABLE_MAPPINGS[norm];

  // 1. Delete dari Supabase
  if (isSupabaseActive() && mapping) {
    try {
      const filters = {};
      filters[mapping.primaryKey] = 'eq.' + primaryKeyVal;
      supabaseDelete(mapping.tableName, filters);
    } catch (e) {
      Logger.log('[Dual-DB] Gagal delete Supabase (' + sheetName + '): ' + e.message);
    }
  }

  // 2. Delete dari Google Sheet
  try {
    const sheet = getSheetCaseInsensitive(sheetName);
    if (sheet) {
      const data = getSheetData(sheetName) || [];
      const pkHeader = mapping ? mapping.sheetPrimaryKey : 'ID';
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][pkHeader] || '').trim() === String(primaryKeyVal || '').trim()) {
          sheet.deleteRow(i + 2);
          delete _executionSheetDataCache[sheet.getName().trim().toUpperCase()];
          break;
        }
      }
    }
  } catch (errSheet) {
    Logger.log('[Dual-DB Backup] Gagal delete Sheet: ' + errSheet.message);
  }
}

// ─── 6. TOOL MIGRASI & SINKRONISASI 1-KLIK (Spreadsheet -> Supabase) ──────────

/**
 * Melakukan migrasi seluruh isi Google Sheets saat ini ke Supabase.
 * Cocok dijalankan pertama kali saat baru menghubungkan Supabase.
 */
function migrateAllSheetsToSupabase() {
  if (!isSupabaseActive()) {
    throw new Error('Supabase belum aktif. Pastikan URL dan API Key telah dikonfigurasi & disimpan.');
  }

  const results = {};
  const sheetNames = ['CONFIG', 'USERS', 'WILAYAH', 'PRODUK', 'OUTLET', 'ABSENSI', 'KUNJUNGAN', 'TRANSAKSI', 'TRANSAKSI DETAIL', 'STOK_SALES'];

  sheetNames.forEach(sheetName => {
    const mapping = TABLE_MAPPINGS[sheetName];
    if (!mapping) return;

    try {
      const rows = getSheetData(sheetName, true) || [];
      if (rows.length === 0) {
        results[sheetName] = 0;
        return;
      }

      const payloads = rows.map(r => mapSheetRowToSupabase(sheetName, r));
      // Kirim dalam chunk 200 baris agar 4x lebih cepat dan aman dari batas timeout eksekusi
      const chunkSize = 200;
      let count = 0;
      for (let i = 0; i < payloads.length; i += chunkSize) {
        const chunk = payloads.slice(i, i + chunkSize);
        supabaseUpsert(mapping.tableName, chunk, mapping.primaryKey);
        count += chunk.length;
      }
      results[sheetName] = count;
    } catch (err) {
      Logger.log('Error migrasi sheet ' + sheetName + ': ' + err.message);
      results[sheetName] = 'Gagal: ' + err.message;
    }
  });

  return {
    success: true,
    message: 'Migrasi data dari Google Sheets ke Supabase selesai!',
    details: results
  };
}

// ─── 7. ANTI-PAUSE 6 HARI TRIGGER (KEEP-ALIVE ENGINE) ─────────────────────────

function setupAntiPauseTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'pingSupabaseKeepAlive') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('pingSupabaseKeepAlive')
    .timeBased()
    .everyDays(3)
    .atHour(8)
    .create();

  pingSupabaseKeepAlive();

  return {
    success: true,
    message: 'Trigger Anti-Pause Supabase 6 Hari berhasil dipasang! Sistem akan otomatis melakukan ping tiap 3 hari agar database Supabase Free Tier tidak pernah auto-pause.'
  };
}

function pingSupabaseKeepAlive() {
  if (isSupabaseActive()) {
    try {
      supabaseSelect('config', { limit: 1 });
      Logger.log('[Keep-Alive] Ping Supabase sukses pada ' + new Date().toISOString());
    } catch (e) {
      Logger.log('[Keep-Alive] Ping Supabase gagal: ' + e.message);
    }
  }
}

function setSupabaseMode(mode) {
  const isHybrid = String(mode).toLowerCase() === 'hybrid';
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SUPABASE_ACTIVE', isHybrid ? 'true' : 'false');
  return {
    success: true,
    active: isHybrid,
    message: isHybrid 
      ? 'Mode Hybrid diaktifkan: Supabase Realtime + Sheets Backup' 
      : 'Mode Standalone diaktifkan: Menggunakan Google Sheets'
  };
}
