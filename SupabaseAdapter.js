/**
 * ==============================================================================
 * SUPABASE ADAPTER & DUAL DATABASE BRIDGE FOR GOOGLE APPS SCRIPT
 * Standar Arsitektur: Skill /migrasi-to-supabase (Hybrid Pattern)
 * ==============================================================================
 * 7 Prinsip Utama:
 * 1. Skema & Kolom Konsisten dengan Google Sheets.
 * 2. Client Browser Hanya Membaca (SELECT via RLS). Operasi tulis via GAS (service_role key).
 * 3. Logika bisnis teruji di Google Apps Script dipertahankan.
 * 4. Stored Procedure efisien via SQL RPC (reserve_ids, gas_bulk_update, sync_sequences).
 * 5. Skrip SQL 100% Idempoten (SETUP_SUPABASE.sql).
 * 6. Kontrak API konsisten: { success, data, message }.
 * 7. Zero literal secret (Kredensial disimpan di Script Properties).
 * ==============================================================================
 */

// ─── 1. PENGELOLAAN KREDENSIAL SCRIPT PROPERTIES ──────────────────────────────

/**
 * Mengambil konfigurasi Supabase dari Script Properties.
 * Mendukung SUPABASE_SERVICE_KEY (standar skill) maupun SUPABASE_KEY.
 * @private
 */
function getSupabaseConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  var key = String(props.getProperty('SUPABASE_SERVICE_KEY') || props.getProperty('SUPABASE_KEY') || '').trim();
  var active = String(props.getProperty('SUPABASE_ACTIVE') || 'false').trim().toLowerCase() === 'true';

  return { url: url, key: key, active: active };
}

/**
 * Memeriksa apakah Supabase sedang aktif dan valid dikonfigurasi.
 * @returns {boolean}
 */
function isSupabaseActive() {
  var cfg = getSupabaseConfig_();
  return Boolean(cfg.active && cfg.url && cfg.key);
}

/**
 * Menyimpan konfigurasi Supabase ke dalam Script Properties (Aman & Terisolasi).
 * @param {string} url - Supabase Project URL (e.g. https://xxx.supabase.co)
 * @param {string} key - Supabase Service Role Key (Direkomendasikan) atau Anon Key
 * @returns {{ success: boolean, message: string }}
 */
function setSupabaseConfig(url, key) {
  if (!url || !key) {
    throw new Error('URL dan API Key Supabase wajib diisi.');
  }

  var cleanUrl = String(url).trim().replace(/\/+$/, '');
  var cleanKey = String(key).trim();

  // Uji koneksi terlebih dahulu sebelum mengaktifkan
  var test = testSupabaseConnection(cleanUrl, cleanKey);
  if (!test.success) {
    throw new Error('Gagal menghubungkan ke Supabase: ' + test.message);
  }

  var props = PropertiesService.getScriptProperties();
  props.setProperties({
    'SUPABASE_URL': cleanUrl,
    'SUPABASE_SERVICE_KEY': cleanKey,
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
  var props = PropertiesService.getScriptProperties();
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
  var cfg = getSupabaseConfig_();
  var maskedKey = '';
  if (cfg.key) {
    var len = cfg.key.length;
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
    var targetUrl = url + '/rest/v1/';
    var response = UrlFetchApp.fetch(targetUrl, {
      method: 'get',
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key
      },
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      return { success: true, message: 'Koneksi aktif (HTTP ' + code + ')' };
    } else {
      var body = response.getContentText();
      return {
        success: false,
        message: 'HTTP ' + code + ': ' + (body.substring(0, 150) || 'Koneksi ditolak')
      };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── 2. STANDAR ENGINE SUPA & REST CLIENT ─────────────────────────────────────

/**
 * Engine Inti Standar /migrasi-to-supabase
 */
var SUPA = {
  cfg: function () {
    var c = getSupabaseConfig_();
    if (!c.url || !c.key) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY belum diatur di Script Properties.');
    }
    return c;
  },

  req: function (method, path, body, extra) {
    var c = this.cfg();
    var headers = {
      'apikey': c.key,
      'Authorization': 'Bearer ' + c.key,
      'Content-Type': 'application/json'
    };
    if (extra) Object.assign(headers, extra);

    var opt = {
      method: method,
      headers: headers,
      muteHttpExceptions: true
    };

    if (body !== undefined && body !== null) {
      opt.payload = typeof body === 'string' ? body : JSON.stringify(body);
    }

    var cleanPath = path.indexOf('http') === 0 ? path : (c.url + '/rest/v1/' + path.replace(/^\/+/, ''));
    var res = UrlFetchApp.fetch(cleanPath, opt);
    var code = res.getResponseCode();
    var text = res.getContentText();

    if (code >= 300) {
      throw new Error('Supabase Error (' + code + '): ' + text);
    }

    return { code: code, text: text, json: text ? JSON.parse(text) : null };
  },

  rpc: function (fn, args) {
    var r = this.req('post', 'rpc/' + fn, args || {});
    return r.json !== null ? r.json : (r.text ? JSON.parse(r.text) : null);
  }
};

/**
 * Wrapper HTTP Fetch internal untuk PostgREST.
 * @private
 */
function supabaseFetch_(path, options) {
  options = options || {};
  var extra = {};
  if (options.prefer) extra['Prefer'] = options.prefer;
  if (options.headers) Object.assign(extra, options.headers);

  var r = SUPA.req(options.method || 'get', path, options.payload, extra);
  return r.json;
}

// ─── 3. OPERASI CRUD SUPABASE DENGAN AUTO-PAGINATION ──────────────────────────

/**
 * Mengambil data dari Supabase PostgREST dengan dukungan Auto-Pagination.
 * Mampu membaca > 1.000 baris secara otomatis dan aman (mengatasi limit default 1000 baris Supabase).
 */
function supabaseSelect(table, options) {
  options = options || {};
  var targetLimit = (options.limit !== undefined && options.limit !== null) ? Number(options.limit) : null;
  var startOffset = options.offset ? Number(options.offset) : 0;
  var PAGE_SIZE = 1000;

  // Tentukan order stabil jika tidak disediakan agar pagination tidak acak/melompat
  var orderParam = options.order;
  if (!orderParam && typeof TABLE_MAPPINGS !== 'undefined') {
    for (var key in TABLE_MAPPINGS) {
      if (TABLE_MAPPINGS[key] && TABLE_MAPPINGS[key].tableName === table) {
        orderParam = TABLE_MAPPINGS[key].primaryKey + '.asc';
        break;
      }
    }
  }

  // Jika limit diminta <= 1000 dan tidak null, cukup 1 kali request
  if (targetLimit !== null && targetLimit <= PAGE_SIZE) {
    var path = table + '?select=' + encodeURIComponent(options.select || '*');
    if (options.filters) {
      for (var col in options.filters) {
        path += '&' + col + '=' + encodeURIComponent(options.filters[col]);
      }
    }
    if (orderParam) path += '&order=' + encodeURIComponent(orderParam);
    path += '&limit=' + targetLimit;
    if (startOffset > 0) path += '&offset=' + startOffset;

    var res = supabaseFetch_(path, { method: 'get' });
    return Array.isArray(res) ? res : [];
  }

  // Auto-pagination loop untuk mengambil data lengkap (>1000 baris atau seluruh tabel)
  var allRows = [];
  var currentOffset = startOffset;
  var maxToFetch = targetLimit !== null ? targetLimit : Infinity;

  while (allRows.length < maxToFetch) {
    var fetchLimit = Math.min(PAGE_SIZE, maxToFetch - allRows.length);
    var p = table + '?select=' + encodeURIComponent(options.select || '*');

    if (options.filters) {
      for (var c in options.filters) {
        p += '&' + c + '=' + encodeURIComponent(options.filters[c]);
      }
    }
    if (orderParam) p += '&order=' + encodeURIComponent(orderParam);
    p += '&limit=' + fetchLimit;
    if (currentOffset > 0) p += '&offset=' + currentOffset;

    var chunk = supabaseFetch_(p, { method: 'get' });
    if (!Array.isArray(chunk) || chunk.length === 0) {
      break;
    }

    allRows = allRows.concat(chunk);
    currentOffset += chunk.length;

    if (chunk.length < fetchLimit) {
      break;
    }
  }

  return allRows;
}

function supabaseInsert(table, payload) {
  return supabaseFetch_(table, {
    method: 'post',
    payload: payload,
    prefer: 'return=representation'
  });
}

function supabaseUpsert(table, payload, onConflict) {
  var prefer = onConflict
    ? 'resolution=merge-duplicates,return=representation'
    : 'return=representation';

  var path = table;
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
  var path = table + '?';
  var filterParts = [];
  if (filters) {
    for (var col in filters) {
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
  var path = table + '?';
  var filterParts = [];
  if (filters) {
    for (var col in filters) {
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

var TABLE_MAPPINGS = {
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
  var norm = String(sheetName || '').trim().toUpperCase();
  var mapping = TABLE_MAPPINGS[norm];
  if (!mapping) return sheetRow;

  var result = {};
  for (var sheetCol in mapping.columns) {
    var supaCol = mapping.columns[sheetCol];
    if (sheetRow[sheetCol] !== undefined) {
      var val = sheetRow[sheetCol];
      // Format nilai tanggal/null/number
      if (val === '-' || val === '' || val === undefined) {
        val = null;
      } else if (typeof val === 'string') {
        // Normalisasi nomor telepon
        if (supaCol === 'nomor_hp' && val.indexOf('+62') === 0) {
          val = '0' + val.substring(3);
        }
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
  var norm = String(sheetName || '').trim().toUpperCase();
  var mapping = TABLE_MAPPINGS[norm];
  if (!mapping) return supaRow;

  var result = {};
  for (var sheetCol in mapping.columns) {
    var supaCol = mapping.columns[sheetCol];
    var val = supaRow[supaCol];
    if (val === null || val === undefined) {
      val = '';
    }
    result[sheetCol] = val;
  }
  return result;
}

// ─── 5. STANDAR OBJEK DB & RPC HELPERS ────────────────────────────────────────

/**
 * Objek DB Standar Kompatibilitas Skill /migrasi-to-supabase
 */
var DB = {
  all: function (name) {
    return dbRead(name);
  },
  find: function (name, col, val) {
    var filt = {};
    filt[col] = 'eq.' + val;
    var norm = String(name || '').trim().toUpperCase();
    var mapping = TABLE_MAPPINGS[norm];
    if (isSupabaseActive() && mapping) {
      var rows = supabaseSelect(mapping.tableName, { filters: filt, limit: 1 });
      return rows && rows.length > 0 ? mapSupabaseRowToSheet(name, rows[0]) : null;
    }
    var sheetData = getSheetData(name) || [];
    return sheetData.find(function (r) { return String(r[col]) === String(val); }) || null;
  },
  query: function (name, filt) {
    return dbRead(name, { filters: filt });
  },
  count: function (name, filt) {
    var norm = String(name || '').trim().toUpperCase();
    var mapping = TABLE_MAPPINGS[norm];
    if (isSupabaseActive() && mapping) {
      var res = supabaseSelect(mapping.tableName, { select: mapping.primaryKey, filters: filt });
      return res ? res.length : 0;
    }
    return (getSheetData(name) || []).length;
  },
  appendBatch: function (name, objs) {
    if (!objs || !objs.length) return;
    var norm = String(name || '').trim().toUpperCase();
    var mapping = TABLE_MAPPINGS[norm];
    if (isSupabaseActive() && mapping) {
      var payloads = objs.map(function (o) { return mapSheetRowToSupabase(name, o); });
      SUPA.req('post', encodeURIComponent(mapping.tableName), payloads, { Prefer: 'return=minimal' });
    }
  },
  updateBatch: function (name, keyCol, patches) {
    var norm = String(name || '').trim().toUpperCase();
    var mapping = TABLE_MAPPINGS[norm];
    var table = mapping ? mapping.tableName : name;
    var pk = mapping && mapping.columns[keyCol] ? mapping.columns[keyCol] : keyCol;
    return Number(SUPA.rpc('gas_bulk_update', { p_table: table, p_key: pk, p_rows: patches })) || 0;
  }
};

/**
 * Mengambil rentang ID terurut dari database sequence Supabase.
 */
function reserveIds_(name, n) {
  var norm = String(name || '').trim().toUpperCase();
  var mapping = TABLE_MAPPINGS[norm];
  var table = mapping ? mapping.tableName : name;
  return SUPA.rpc('reserve_ids', { p_table: table, p_n: n || 1 }) || [];
}

// ─── 6. DUAL-DATABASE HYBRID DATA LAYER ───────────────────────────────────────

/**
 * Membaca data dengan prioritas: Supabase (jika aktif) -> Fallback ke Spreadsheet.
 * Mengembalikan array of objects dengan key header Google Sheet yang identik!
 */
function dbRead(sheetName, options) {
  var norm = String(sheetName || '').trim().toUpperCase();
  var mapping = TABLE_MAPPINGS[norm];

  if (isSupabaseActive() && mapping) {
    try {
      var supaRows = supabaseSelect(mapping.tableName, options);
      if (Array.isArray(supaRows)) {
        return supaRows.map(function (row) { return mapSupabaseRowToSheet(sheetName, row); });
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
  var norm = String(sheetName || '').trim().toUpperCase();
  var mapping = TABLE_MAPPINGS[norm];

  // 1. Tulis ke Supabase jika aktif
  if (isSupabaseActive() && mapping) {
    try {
      var supaPayload = mapSheetRowToSupabase(sheetName, dataMap);
      supabaseInsert(mapping.tableName, supaPayload);
    } catch (e) {
      Logger.log('[Dual-DB] Gagal insert ke Supabase (' + sheetName + '): ' + e.message);
    }
  }

  // 2. Selalu cadangkan ke Google Sheets
  try {
    var sheet = getSheetCaseInsensitive(sheetName);
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
  var norm = String(sheetName || '').trim().toUpperCase();
  var mapping = TABLE_MAPPINGS[norm];

  // 1. Update ke Supabase
  if (isSupabaseActive() && mapping) {
    try {
      var supaPayload = mapSheetRowToSupabase(sheetName, updateMap);
      var filters = {};
      filters[mapping.primaryKey] = 'eq.' + primaryKeyVal;
      supabaseUpdate(mapping.tableName, supaPayload, filters);
    } catch (e) {
      Logger.log('[Dual-DB] Gagal update Supabase (' + sheetName + '): ' + e.message);
    }
  }

  // 2. Update di Google Sheet
  try {
    var sheet = getSheetCaseInsensitive(sheetName);
    if (sheet) {
      var data = getSheetData(sheetName) || [];
      var pkHeader = mapping ? mapping.sheetPrimaryKey : 'ID';
      for (var i = 0; i < data.length; i++) {
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
  var norm = String(sheetName || '').trim().toUpperCase();
  var mapping = TABLE_MAPPINGS[norm];

  // 1. Delete dari Supabase
  if (isSupabaseActive() && mapping) {
    try {
      var filters = {};
      filters[mapping.primaryKey] = 'eq.' + primaryKeyVal;
      supabaseDelete(mapping.tableName, filters);
    } catch (e) {
      Logger.log('[Dual-DB] Gagal delete Supabase (' + sheetName + '): ' + e.message);
    }
  }

  // 2. Delete dari Google Sheet
  try {
    var sheet = getSheetCaseInsensitive(sheetName);
    if (sheet) {
      var data = getSheetData(sheetName) || [];
      var pkHeader = mapping ? mapping.sheetPrimaryKey : 'ID';
      for (var i = 0; i < data.length; i++) {
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

// ─── 7. TOOL MIGRASI & SINKRONISASI 1-KLIK (Spreadsheet -> Supabase) ──────────

/**
 * Fungsi Utama Standar: migrasiSheetsKeSupabase
 * Sesuai panduan skill /migrasi-to-supabase.
 * Aman diulang kapan pun (Idempoten via UPSERT & Chunking).
 */
function migrasiSheetsKeSupabase() {
  if (!isSupabaseActive()) {
    throw new Error('Supabase belum aktif. Pastikan URL dan API Key telah dikonfigurasi & disimpan.');
  }

  var results = {};
  var sheetNames = [
    'CONFIG', 'USERS', 'WILAYAH', 'PRODUK', 'OUTLET',
    'ABSENSI', 'KUNJUNGAN', 'TRANSAKSI', 'TRANSAKSI DETAIL', 'STOK_SALES'
  ];

  sheetNames.forEach(function (sheetName) {
    var mapping = TABLE_MAPPINGS[sheetName];
    if (!mapping) return;

    try {
      var rows = getSheetData(sheetName, true) || [];
      if (rows.length === 0) {
        results[sheetName] = 0;
        return;
      }

      var payloads = rows.map(function (r) { return mapSheetRowToSupabase(sheetName, r); });
      // Kirim dalam chunk 200 baris agar aman dari batas timeout eksekusi 6 menit Apps Script
      var chunkSize = 200;
      var count = 0;
      for (var i = 0; i < payloads.length; i += chunkSize) {
        var chunk = payloads.slice(i, i + chunkSize);
        supabaseUpsert(mapping.tableName, chunk, mapping.primaryKey);
        count += chunk.length;
      }
      results[sheetName] = count;
    } catch (err) {
      Logger.log('Error migrasi sheet ' + sheetName + ': ' + err.message);
      results[sheetName] = 'Gagal: ' + err.message;
    }
  });

  // Sinkronisasi sequences setelah data selesai di-import
  var syncResult = null;
  try {
    syncResult = SUPA.rpc('sync_sequences');
    Logger.log('[Migration] Sequences disinkronkan: ' + JSON.stringify(syncResult));
  } catch (errSync) {
    Logger.log('[Migration] Gagal sync sequences: ' + errSync.message);
  }

  return {
    success: true,
    message: 'Migrasi data dari Google Sheets ke Supabase berhasil diselesaikan!',
    details: results,
    sequences: syncResult
  };
}

/**
 * Alias fungsi untuk kompatibilitas tombol UI lama.
 */
function migrateAllSheetsToSupabase() {
  return migrasiSheetsKeSupabase();
}

// ─── 8. ANTI-PAUSE 6 HARI TRIGGER (KEEP-ALIVE ENGINE) ─────────────────────────

function setupAntiPauseTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
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
  var isHybrid = String(mode).toLowerCase() === 'hybrid';
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SUPABASE_ACTIVE', isHybrid ? 'true' : 'false');
  return {
    success: true,
    active: isHybrid,
    message: isHybrid
      ? 'Mode Hybrid diaktifkan: Supabase Realtime + Sheets Backup'
      : 'Mode Standalone diaktifkan: Menggunakan Google Sheets'
  };
}
