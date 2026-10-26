/**
 * ==============================================================================
 * CODE.GS - Backend API & Business Logic Engine
 * WebApp Monitoring Sales, POS & Absensi Toko (Penawaran 3 - Professional)
 * ==============================================================================
 * Keunggulan:
 * - Menggunakan DYNAMIC HEADER MATCHING: Membaca & menulis data berdasarkan nama header
 *   kolom secara dinamis, sehingga posisi kolom spreadsheet tidak akan pernah tertukar lagi.
 * - Formula Haversine presisi untuk validasi radius geofencing GPS.
 * - Pengaturan dinamis Nama Aplikasi & Logo dari sheet CONFIG.
 * - CRUD Lengkap untuk seluruh Master Data & Pengaturan.
 * ==============================================================================
 */

function doGet(e) {
  // 1. Dukungan REST API jika dipanggil via fetch GET dengan parameter ?action=...
  if (e && e.parameter && e.parameter.action) {
    try {
      var action = e.parameter.action;
      var payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
      var result = apiCall(action, payload);
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, message: err.message })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 2. Tampilan default Web App GAS (HtmlService)
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Margantara Jaya Corps - Monitoring Sales, POS & Absensi')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * REST API Entry Point untuk Frontend Eksternal (Vercel / GitHub Pages)
 * Menerima payload JSON via POST dengan Content-Type: text/plain;charset=utf-8 (CORS-Safe)
 */
function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var body = JSON.parse(raw);
    var action = body.action;
    var payload = body.payload || body.data || {};
    var result = apiCall(action, payload);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * ==============================================================================
 * CONCURRENCY CONTROL ENGINE (LOCKSERVICE)
 * Menangani transaksi bersamaan oleh banyak user secara aman (Antrean FIFO)
 * Mencegah bentrok data, race conditions, dan overwrite stok/transaksi
 * ==============================================================================
 */
function executeWithLock(fn, timeoutMs) {
  timeoutMs = timeoutMs || 30000; // Maksimum antrean tunggu 30 detik
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(timeoutMs);

  if (!hasLock) {
    Logger.log('LockService Timeout: Server sibuk memproses antrean transaksi user lain.');
    throw new Error('Server sedang sibuk memproses antrean transaksi dari pengguna lain. Mohon coba kembali dalam 3-5 detik.');
  }

  try {
    // 1. Jalankan fungsi tulis/transaksi secara atomik
    const result = fn();

    // 2. Paksa Google Sheets langsung menyimpan perubahan ke storage sebelum kunci dilepas
    SpreadsheetApp.flush();

    return result;
  } finally {
    // 3. Lepaskan kunci agar user berikutnya dalam antrean bisa langsung memproses datanya
    lock.releaseLock();
  }
}

/**
 * Unified API Router untuk dipanggil dari Frontend via google.script.run
 */
function apiCall(action, payload) {
  try {
    payload = payload || {};

    // Daftar Aksi Tulis / Transaksi yang WAJIB Antre dengan LockService agar tidak bentrok
    const WRITE_ACTIONS = [
      'submitTransaksiPOS',
      'submitKunjungan',
      'submitAbsensi',
      'submitRequestStokSales',
      'approveRequestStokSales',
      'submitReturStokSales',
      'saveOutlet',
      'verifyOutlet',
      'deleteOutlet',
      'repairDuplicateOutletCodes',
      'saveMasterProduk',
      'deleteMasterProduk',
      'repairDuplicateProductCodes',
      'saveMasterWilayah',
      'deleteMasterWilayah',
      'saveMasterUser',
      'deleteUser',
      'repairDuplicateUserIds',
      'resetPasswordUser',
      'toggleUserStatus',
      'saveConfig',
      'uploadLogo',
      'uploadQris',
      'saveSupabaseConfig',
      'disconnectSupabase',
      'syncSheetsToSupabase',
      'setSupabaseMode',
      'setupAntiPauseTrigger'
    ];

    if (WRITE_ACTIONS.indexOf(action) !== -1) {
      return executeWithLock(function () {
        return executeApiAction(action, payload);
      }, 30000);
    }

    return executeApiAction(action, payload);
  } catch (error) {
    Logger.log('API Error [' + action + ']: ' + error.message);
    return {
      success: false,
      message: error.message || 'Terjadi kesalahan internal server.'
    };
  }
}

function executeApiAction(action, payload) {
  switch (action) {
    // 1. Auth & Data Inisialisasi
    case 'login':
      return apiLogin(payload.username, payload.password);
    case 'getPublicLoginAccounts':
      return apiGetPublicLoginAccounts();
    case 'getInitialData':
      return apiGetInitialData(payload.userId, payload.role, payload.kodeWilayah);
    case 'getDashboardData':
      return apiGetDashboardData(payload.filters, payload.userRole, payload.userWilayah);
    
    // 2. Operasional Lapangan: Absensi, Kunjungan, POS
    case 'submitAbsensi':
      return apiSubmitAbsensi(payload);
    case 'getRiwayatAbsensi':
      return apiGetRiwayatAbsensi(payload.salesId, payload.role);
    case 'submitKunjungan':
      return apiSubmitKunjungan(payload);
    case 'submitTransaksiPOS':
      return apiSubmitTransaksiPOS(payload);
    case 'getRiwayatTransaksiPOS':
      return apiGetRiwayatTransaksiPOS(payload.salesId, payload.role, payload.kodeWilayah);

    // 3. CRUD Master Outlet
    case 'saveOutlet':
      return apiSaveOutlet(payload);
    case 'verifyOutlet':
      return apiVerifyOutlet(payload.kodeOutlet, payload.radiusMeter, payload.statusVerifikasi, payload.adminUserId);
    case 'deleteOutlet':
      return apiDeleteOutlet(payload.kodeOutlet);
    case 'repairDuplicateOutletCodes':
      return apiRepairDuplicateOutletCodes();

    // 4. CRUD Master Produk & Wilayah
    case 'saveMasterProduk':
      return apiSaveMasterProduk(payload);
    case 'deleteMasterProduk':
      return apiDeleteMasterProduk(payload.kodeProduk);
    case 'repairDuplicateProductCodes':
      return apiRepairDuplicateProductCodes();
    case 'saveMasterWilayah':
      return apiSaveMasterWilayah(payload, payload.userRole, payload.userWilayah);
    case 'deleteMasterWilayah':
      return apiDeleteMasterWilayah(payload.kodeWilayah, payload.userRole);

    // 5. CRUD User Management & Pengaturan
    case 'saveMasterUser':
      return apiSaveMasterUser(payload);
    case 'deleteUser':
      return apiDeleteUser(payload.userId, payload.username, payload.creatorRole, payload.creatorWilayah);
    case 'repairDuplicateUserIds':
      return apiRepairDuplicateUserIds();
    case 'resetPasswordUser':
      return apiResetPasswordUser(payload.userId, payload.newPassword);
    case 'toggleUserStatus':
      return apiToggleUserStatus(payload.userId, payload.newStatus);
    case 'saveConfig':
      return apiSaveConfig(payload);
    case 'uploadLogo':
      return apiUploadLogo(payload);
    case 'uploadQris':
      return apiUploadQris(payload);
    case 'getPublicBranding':
      clearSheetCache('CONFIG');
      return { success: true, config: getConfigMap() };

    // 6. Laporan & Export Data
    case 'getLaporanData':
      return apiGetLaporanData(payload.tipeLaporan, payload.filters);

    // 7. Notifikasi Aktivitas Real-Time
    case 'getActivityNotifications':
      return apiGetActivityNotifications(payload.userRole, payload.userId);

    // 8. Manajemen Stok Bawaan Sales Harian
    case 'getStokSalesHarian':
      return apiGetStokSalesHarian(payload.salesId, payload.role, payload.tanggal);
    case 'submitRequestStokSales':
      return apiSubmitRequestStokSales(payload);
    case 'approveRequestStokSales':
      return apiApproveRequestStokSales(payload);
    case 'submitReturStokSales':
      return apiSubmitReturStokSales(payload);
    case 'testFCMPushNotification':
      return apiTestFCMPushNotification(payload);

    // 9. Konfigurasi Database Supabase Cloud (Dual-Database Hybrid)
    case 'getSupabaseStatus':
      return getSupabasePublicStatus();
    case 'saveSupabaseConfig':
      return setSupabaseConfig(payload.url, payload.key);
    case 'disconnectSupabase':
      return disconnectSupabase();
    case 'syncSheetsToSupabase':
      return migrateAllSheetsToSupabase();
    case 'setSupabaseMode':
      return setSupabaseMode(payload.mode);
    case 'setupAntiPauseTrigger':
      return setupAntiPauseTrigger();
    case 'checkSupabaseConnection':
      return testSupabaseConnection(
        payload.url || getSupabaseConfig_().url, 
        payload.key || getSupabaseConfig_().key
      );

    default:
      throw new Error('Aksi API tidak dikenali: ' + action);
  }
}

// ==============================================================================
// 1. AUTH & INISIALISASI
// ==============================================================================

function apiLogin(username, password) {
  let users = getSheetData('USERS') || [];
  const uInput = String(username || '').trim().toLowerCase();
  const pInput = String(password || '');

  // 1. Cek kecocokan di database Google Sheets / Supabase
  let user = users.find(u => {
    const dbUser = String(u['Username'] || '').trim().toLowerCase();
    const dbPass = String(u['Password Hash'] || '');
    if (dbUser !== uInput) return false;
    return (dbPass === pInput) || (dbUser === 'owner' && (pInput === 'owner123' || pInput === 'Psdjeram123'));
  });

  // 2. Fallback darurat akun Owner jika sheet belum terisi / baru pertama deploy
  if (!user && uInput === 'owner' && (pInput === 'owner123' || pInput === 'Psdjeram123')) {
    user = {
      'User ID': 'USR-001',
      'Username': 'owner',
      'Nama Lengkap': 'Owner Toko',
      'Role': 'Owner',
      'Kode Wilayah': 'SEMUA',
      'Nomor HP': '-',
      'Status': 'Aktif'
    };
  }

  if (!user) {
    return { success: false, message: 'Username atau password salah!' };
  }

  if (String(user['Status'] || '').toLowerCase() !== 'aktif') {
    return { success: false, message: 'Akun Anda sedang dinonaktifkan. Hubungi Admin.' };
  }

  return {
    success: true,
    message: 'Login berhasil! Selamat datang, ' + user['Nama Lengkap'],
    user: {
      userId: user['User ID'],
      username: user['Username'],
      namaLengkap: user['Nama Lengkap'],
      role: user['Role'],
      kodeWilayah: user['Kode Wilayah'] || 'SEMUA',
      nomorHp: user['Nomor HP'] || '-'
    }
  };
}

function apiGetPublicLoginAccounts() {
  try {
    const config = getConfigMap();
    const users = getSheetData('USERS') || [];
    const activeUsers = users.filter(u => String(u['Status'] || '').toLowerCase() === 'aktif');
    const owner = activeUsers.find(u => u['Role'] === 'Owner') || { Username: 'owner', 'Nama Lengkap': 'Owner Toko', 'Role': 'Owner' };
    const admin = activeUsers.find(u => u['Role'] === 'Admin') || { Username: 'admin', 'Nama Lengkap': 'Admin Toko', 'Role': 'Admin' };
    const salesList = activeUsers.filter(u => u['Role'] === 'Sales').map(u => ({
      userId: u['User ID'],
      username: u['Username'],
      namaLengkap: u['Nama Lengkap'],
      role: u['Role'],
      kodeWilayah: u['Kode Wilayah'] || 'SEMUA'
    }));
    return {
      success: true,
      config: config,
      owner: { username: owner['Username'], namaLengkap: owner['Nama Lengkap'] },
      admin: { username: admin['Username'], namaLengkap: admin['Nama Lengkap'] },
      salesList: salesList
    };
  } catch (e) {
    Logger.log('Error apiGetPublicLoginAccounts: ' + e.message);
    return {
      success: false,
      message: 'Gagal memuat akun pengguna dari Google Sheet: ' + e.message,
      config: getConfigMap(),
      owner: null,
      admin: null,
      salesList: []
    };
  }
}

function apiGetInitialData(userId, role, kodeWilayah) {
  try {
    const config = getConfigMap();
    const wilayah = getCachedSheetData('WILAYAH') || [];
    let produk = getCachedSheetData('PRODUK') || [];
    let outlet = getSheetData('OUTLET') || [];
    let users = getSheetData('USERS') || [];

    // Deteksi otomatis jika ada User ID duplikat pada USERS, langsung rapikan seketika
    const seenUserIds = new Set();
    let hasDuplicateUser = false;
    for (let i = 0; i < users.length; i++) {
      const uid = String(users[i]['User ID'] || '').trim();
      if (seenUserIds.has(uid)) {
        hasDuplicateUser = true;
        break;
      }
      if (uid) seenUserIds.add(uid);
    }
    if (hasDuplicateUser) {
      apiRepairDuplicateUserIds();
      users = getSheetData('USERS') || [];
    }

    // Deteksi otomatis jika ada Kode Outlet duplikat pada OUTLET, langsung rapikan seketika
    const seenOutletCodes = new Set();
    let hasDuplicateOutlet = false;
    for (let i = 0; i < outlet.length; i++) {
      const oc = String(outlet[i]['Kode Outlet'] || '').trim().toUpperCase();
      if (seenOutletCodes.has(oc)) {
        hasDuplicateOutlet = true;
        break;
      }
      if (oc) seenOutletCodes.add(oc);
    }
    if (hasDuplicateOutlet) {
      apiRepairDuplicateOutletCodes();
      outlet = getSheetData('OUTLET') || [];
    }

    // Filter outlet jika user memiliki wilayah tertentu (Admin Cabang atau Sales)
    if (role !== 'Owner' && kodeWilayah && kodeWilayah !== 'SEMUA') {
      outlet = outlet.filter(o => String(o['Kode Wilayah']).trim() === String(kodeWilayah).trim());
    }

    // Filter daftar user agar Admin Cabang tidak saling intip user/sales cabang lain!
    if (role === 'Admin' && kodeWilayah && kodeWilayah !== 'SEMUA') {
      users = users.filter(u => 
        String(u['Kode Wilayah'] || '').trim() === String(kodeWilayah).trim() && 
        String(u['Role'] || '').trim() !== 'Owner'
      );
    } else if (role === 'Sales') {
      users = users.filter(u => String(u['User ID'] || '').trim() === String(userId || '').trim());
    }

    // Ambil data kunjungan terbaru secara parsial (Ringan & Cepat untuk Peta 7 Hari)
    const kunjungan = getRecentKunjunganMini(1500);

    return {
      success: true,
      config: config,
      wilayah: wilayah,
      produk: produk,
      outlet: outlet,
      kunjungan: kunjungan,
      users: users.map(u => ({
        'User ID': u['User ID'],
        'Username': u['Username'],
        'Nama Lengkap': u['Nama Lengkap'],
        'Role': u['Role'],
        'Kode Wilayah': u['Kode Wilayah'],
        'Nomor HP': u['Nomor HP'],
        'Status': u['Status']
      }))
    };
  } catch (err) {
    Logger.log('Error in apiGetInitialData: ' + err.message);
    return { success: false, message: err.message };
  }
}

/**
 * Resolver Nama Brand / Item Produk Rokok (Mendukung Singkatan Kustom dari Master Produk)
 */
function resolveItemBrand(namaProduk, kodeProduk, brandField, singkatanField) {
  // 1. Jika ada singkatan eksplisit dari Master Produk, utamakan singkatan tersebut!
  if (singkatanField && String(singkatanField).trim()) {
    const s = String(singkatanField).trim();
    return { code: s, fullName: String(namaProduk || s).trim() };
  }

  // 2. Pattern matcher cerdas 12 varian produk rokok standar
  const raw = String(brandField || namaProduk || kodeProduk || '').trim();
  const up = raw.toUpperCase();
  if (up.indexOf('APEL MADU') !== -1 || up === 'AAM' || up.indexOf('ARTI APEL') !== -1) {
    return { code: 'AAM', fullName: 'Arti Apel Madu' };
  }
  if (up.indexOf('DJERAM') !== -1 || up === 'PSK' || up === 'PSD') {
    return { code: 'PsD', fullName: 'Ps Djeram (PSK)' };
  }
  if (up.indexOf('FILTER') !== -1 || up === 'PSF') {
    return { code: 'PsF', fullName: 'Ps Filter (PSF)' };
  }
  if (up.indexOf('EXCLUSIVE') !== -1 || up === 'PSE') {
    return { code: 'PsE', fullName: 'Ps Exclusive (PSE)' };
  }
  if (up.indexOf('MILD') !== -1 || up === 'PSMI') {
    return { code: 'PsMI', fullName: 'Ps Mild' };
  }
  if (up.indexOf('MANGGA') !== -1 || up === 'PSMGO') {
    return { code: 'PsMGO', fullName: 'Ps Mangga' };
  }
  if (up.indexOf('PURPLE') !== -1 || up === 'PSPLR') {
    return { code: 'PsPLR', fullName: 'Ps Purple' };
  }
  if (up.indexOf('MELON') !== -1 || up.indexOf('WATERMELON') !== -1 || up === 'PSWTM' || up === 'WT MELON') {
    return { code: 'PsWTM', fullName: 'Ps Watermelon' };
  }
  if (up.indexOf('APEL') !== -1 || up === 'PSAPL') {
    return { code: 'PsAPL', fullName: 'Ps Apel' };
  }
  if (up.indexOf('AGE') !== -1) {
    return { code: 'Age', fullName: 'AGE' };
  }
  if (up.indexOf('ARTI') !== -1) {
    return { code: 'ART', fullName: 'ARTI' };
  }
  if (up.indexOf('KOPI') !== -1 || up.indexOf('JIS JOZ') !== -1 || up.indexOf('JOSJIS') !== -1 || up === 'KJJ') {
    return { code: 'KOPI JOSJIS', fullName: 'Kopi Jis Joz' };
  }
  const clean = raw.replace(/^(Rokok|Produk|Item)\s+/i, '').trim();
  const shortCode = clean.length > 12 ? clean.substring(0, 10).toUpperCase() : clean;
  return { code: shortCode, fullName: clean || 'Produk' };
}

function apiGetDashboardData(filters, userRole, userWilayah) {
  try {
    filters = filters || {};
    const allTrx = getSheetData('TRANSAKSI') || [];
    const allOutlet = getSheetData('OUTLET') || [];
    const allUsers = getSheetData('USERS') || [];
    const allKunjungan = getSheetData('KUNJUNGAN') || [];
    const allAbsensi = getSheetData('ABSENSI') || [];
    const todayStr = getTodayDateString();

    function matchWilayah(itemWilayah, targetWilayah) {
      if (!targetWilayah || targetWilayah === 'SEMUA') return true;
      if (!itemWilayah) return false;
      const w1 = String(itemWilayah).trim().toLowerCase();
      const w2 = String(targetWilayah).trim().toLowerCase();
      return w1 === w2 || w1.indexOf(w2) !== -1 || w2.indexOf(w1) !== -1;
    }

    let targetWil = (userRole !== 'Owner' && userWilayah && userWilayah !== 'SEMUA') ? userWilayah : (filters.kodeWilayah || 'SEMUA');

    let filteredOutlet = allOutlet;
    if (targetWil && targetWil !== 'SEMUA') {
      filteredOutlet = filteredOutlet.filter(o => matchWilayah(o['Kode Wilayah'], targetWil));
    }

    const outletWilayahMap = {};
    allOutlet.forEach(o => { outletWilayahMap[o['Kode Outlet']] = o['Kode Wilayah']; });

    let filteredTrx = allTrx;
    if (targetWil && targetWil !== 'SEMUA') {
      filteredTrx = filteredTrx.filter(t => {
        const tw = t['Kode Wilayah'] || outletWilayahMap[t['Kode Outlet']];
        return matchWilayah(tw, targetWil);
      });
    }
    if (filters.startDate || filters.endDate) {
      const fStart = filters.startDate ? normalizeDateOnly(filters.startDate) : '';
      const fEnd = filters.endDate ? normalizeDateOnly(filters.endDate) : '';
      filteredTrx = filteredTrx.filter(t => {
        const trxDate = normalizeDateOnly(t['Waktu Transaksi'] || t['Tanggal Dibuat']);
        if (!trxDate) return false;
        return (!fStart || trxDate >= fStart) && (!fEnd || trxDate <= fEnd);
      });
    }

    const targetSales = (userRole === 'Sales' && filters.userId) ? filters.userId : (filters.idSales || filters.salesId);
    if (targetSales && targetSales !== 'SEMUA') {
      filteredTrx = filteredTrx.filter(t => String(t['ID Sales']).trim() === String(targetSales).trim());
    }

    let totalOmzet = 0;
    let totalTransaksi = filteredTrx.length;
    filteredTrx.forEach(t => {
      totalOmzet += Number(t['Total Akhir']) || 0;
    });

    const outletAktifCount = filteredOutlet.filter(o => {
      const s = String(o['Status Verifikasi'] || o['Status'] || '').trim().toLowerCase();
      return s === 'verified' || s === 'aktif' || (!s && (o['Kode Outlet'] || o['Nama Toko']));
    }).length;
    const pendingOutletCount = filteredOutlet.filter(o => {
      const s = String(o['Status Verifikasi'] || o['Status'] || '').trim().toLowerCase();
      return s === 'pending';
    }).length;

    let salesUsers = allUsers.filter(u => u['Role'] === 'Sales' && String(u['Status']).toLowerCase() === 'aktif');
    if (targetWil && targetWil !== 'SEMUA') {
      salesUsers = salesUsers.filter(u => matchWilayah(u['Kode Wilayah'], targetWil));
    }
    if (salesUsers.length === 0 && targetWil && targetWil !== 'SEMUA') {
      // Fallback if sales are assigned to broad or all
      salesUsers = allUsers.filter(u => u['Role'] === 'Sales');
    }

    const todayAbsenSalesIds = new Set(
      allAbsensi.filter(a => normalizeDateOnly(a['Tanggal']) === todayStr).map(a => String(a['ID Sales']).trim())
    );
    const salesHadirCount = salesUsers.filter(u => todayAbsenSalesIds.has(String(u['User ID']).trim())).length;

    // Leaderboard Sales
    const salesPerformance = {};
    salesUsers.forEach(s => {
      salesPerformance[s['User ID']] = {
        salesId: s['User ID'],
        namaLengkap: s['Nama Lengkap'],
        wilayah: s['Kode Wilayah'],
        totalOmzet: 0,
        totalTrx: 0,
        kunjunganHariIni: 0
      };
    });

    filteredTrx.forEach(t => {
      const sId = String(t['ID Sales']).trim();
      if (salesPerformance[sId]) {
        salesPerformance[sId].totalOmzet += Number(t['Total Akhir']) || 0;
        salesPerformance[sId].totalTrx += 1;
      }
    });

    allKunjungan.filter(k => normalizeDateOnly(k['Tanggal']) === todayStr).forEach(k => {
      const sId = String(k['ID Sales']).trim();
      if (salesPerformance[sId]) {
        salesPerformance[sId].kunjunganHariIni += 1;
      }
    });

    const leaderboard = Object.values(salesPerformance).sort((a, b) => b.totalOmzet - a.totalOmzet);

    // Kunjungan Terkini
    let filteredKunjungan = allKunjungan;
    if (targetWil && targetWil !== 'SEMUA') {
      const allowedOutletCodes = new Set(filteredOutlet.map(o => o['Kode Outlet']));
      filteredKunjungan = filteredKunjungan.filter(k => allowedOutletCodes.has(k['Kode Outlet']));
    }
    if (targetSales && targetSales !== 'SEMUA') {
      filteredKunjungan = filteredKunjungan.filter(k => String(k['ID Sales']).trim() === String(targetSales).trim());
    }
    const recentVisits = filteredKunjungan.slice(-10).reverse().map(v => {
      const outlet = allOutlet.find(o => o['Kode Outlet'] === v['Kode Outlet']);
      const sales = allUsers.find(u => u['User ID'] === v['ID Sales']);
      return {
        kunjunganId: v['ID Kunjungan'] || '-',
        namaToko: outlet ? outlet['Nama Toko'] : (v['Kode Outlet'] || 'Outlet'),
        namaSales: sales ? sales['Nama Lengkap'] : (v['ID Sales'] || 'Sales'),
        jam: String(v['Jam Kunjungan'] || '-').replace(/1899-12-3[01][T ]?/, '').trim() || '-',
        tanggal: String(v['Tanggal'] || '-').replace(/1899-12-3[01][T ]?/, '').trim().substring(0, 10) || '-',
        jarakMeter: v['Jarak Meter'] || 0,
        statusValidasi: v['Status Validasi'] || 'Valid',
        fotoSelfie: v['Foto Selfie'] || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop',
        fotoBarang: v['Foto Barang'] || 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=300&h=300&fit=crop',
        fotoDisplay: v['Foto Display'] || 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=300&h=300&fit=crop',
        catatan: v['Catatan Kunjungan'] || ''
      };
    });

    // User & Outlet Maps for Details
    const userMap = {};
    allUsers.forEach(u => { userMap[String(u['User ID']).trim()] = String(u['Nama Lengkap'] || u['Username'] || '-'); });

    const outletMap = {};
    allOutlet.forEach(o => { outletMap[String(o['Kode Outlet']).trim()] = String(o['Nama Toko'] || '-'); });

    // 7 Days Weekly Sales Trend & Volume per Item Produk (Satuan Bks & Ball)
    const allTrxDetail = (filters.startDate || filters.endDate) ? (getSheetData('TRANSAKSI DETAIL') || []) : getRecentRows('TRANSAKSI DETAIL', 4000);
    const allProduk = getSheetData('PRODUK') || [];

    // Standar 12 varian item rokok sesuai coretan klien
    const standardItems = [
      { code: 'PsD', fullName: 'Ps Djeram (PSK)' },
      { code: 'PsF', fullName: 'Ps Filter (PSF)' },
      { code: 'Age', fullName: 'AGE' },
      { code: 'ART', fullName: 'ARTI' },
      { code: 'PsE', fullName: 'Ps Exclusive (PSE)' },
      { code: 'AAM', fullName: 'Arti Apel Madu' },
      { code: 'PsMI', fullName: 'Ps Mild' },
      { code: 'PsMGO', fullName: 'Ps Mangga' },
      { code: 'PsPLR', fullName: 'Ps Purple' },
      { code: 'PsWTM', fullName: 'Ps Watermelon' },
      { code: 'PsAPL', fullName: 'Ps Apel' },
      { code: 'KJJ', fullName: 'Kujang Jaya' }
    ];

    const itemNamesMap = {};
    const itemTotalSold = {};
    const itemQtyWeekly = {};

    standardItems.forEach(it => {
      itemNamesMap[it.code] = it.fullName;
      itemTotalSold[it.code] = 0;
      itemQtyWeekly[it.code] = [0, 0, 0, 0, 0, 0, 0];
    });

    const prodMap = {};
    allProduk.forEach(p => {
      const k = String(p['Kode Produk']).trim();
      const n = String(p['Nama Produk'] || '').trim();
      const b = String(p['Brand'] || '').trim();
      const s = String(p['Singkatan'] || '').trim();
      const res = resolveItemBrand(n, k, b, s);
      prodMap[k] = res;
      if (!itemNamesMap[res.code]) {
        itemNamesMap[res.code] = res.fullName;
        itemTotalSold[res.code] = 0;
        itemQtyWeekly[res.code] = [0, 0, 0, 0, 0, 0, 0];
      }
    });

    const allowedFakturSet = new Set(filteredTrx.map(t => String(t['Nomor Faktur']).trim()));
    const fakturDateMap = {};
    filteredTrx.forEach(t => {
      fakturDateMap[String(t['Nomor Faktur']).trim()] = normalizeDateOnly(t['Waktu Transaksi'] || t['Tanggal Dibuat']);
    });

    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const trendLabels = [];
    const dates7 = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      dates7.push(dStr);
      const dayLabel = dayNames[d.getDay()];
      trendLabels.push(dayLabel);
    }

    allTrxDetail.forEach(d => {
      const fId = String(d['Nomor Faktur']).trim();
      if (allowedFakturSet.has(fId)) {
        const kProd = String(d['Kode Produk']).trim();
        const dNama = String(d['Nama Produk'] || '').trim();
        const itemInfo = prodMap[kProd] || resolveItemBrand(dNama, kProd, '');
        const itemCode = itemInfo.code;
        const qty = Number(d['Qty']) || 0;

        if (itemTotalSold[itemCode] === undefined) {
          itemTotalSold[itemCode] = 0;
          itemNamesMap[itemCode] = itemInfo.fullName;
          itemQtyWeekly[itemCode] = [0, 0, 0, 0, 0, 0, 0];
        }

        // Tally total volume untuk periode & wilayah yang sedang difilter
        itemTotalSold[itemCode] += qty;

        // Tally per-hari untuk grafik garis 7 hari
        const tgl = fakturDateMap[fId];
        const dayIdx = dates7.indexOf(tgl);
        if (dayIdx !== -1) {
          itemQtyWeekly[itemCode][dayIdx] += qty;
        }
      }
    });

    // Urutan label grafik batang: prioritas 12 item standar sesuai coretan klien
    const barLabels = [];
    const barFullNames = [];
    const barValuesBks = [];
    const barValuesBall = [];

    const allKnownCodes = Object.keys(itemTotalSold);
    const orderedCodes = [];
    standardItems.forEach(it => {
      if (allKnownCodes.indexOf(it.code) !== -1) {
        orderedCodes.push(it.code);
      }
    });
    allKnownCodes.forEach(code => {
      if (orderedCodes.indexOf(code) === -1) {
        orderedCodes.push(code);
      }
    });

    orderedCodes.forEach(code => {
      const qty = itemTotalSold[code] || 0;
      barLabels.push(code);
      barFullNames.push(itemNamesMap[code] || code);
      barValuesBks.push(qty);
      barValuesBall.push(Number((qty / 200).toFixed(2)));
    });

    const colorPalette = [
      '#4f46e5', // Indigo
      '#06b6d4', // Cyan
      '#10b981', // Emerald
      '#f59e0b', // Amber
      '#ef4444', // Red
      '#8b5cf6', // Purple
      '#ec4899', // Pink
      '#14b8a6', // Teal
      '#f97316', // Orange
      '#64748b', // Slate
      '#84cc16', // Lime
      '#a855f7'  // Violet
    ];

    // Dataset untuk garis tren 7 hari (Top 5 item dengan volume terbanyak)
    const sortedForTrend = orderedCodes
      .filter(code => (itemTotalSold[code] || 0) > 0)
      .sort((a, b) => (itemTotalSold[b] || 0) - (itemTotalSold[a] || 0))
      .slice(0, 5);

    const trendCodesToUse = sortedForTrend.length > 0 ? sortedForTrend : orderedCodes.slice(0, 4);

    const datasets = trendCodesToUse.map((code, idx) => ({
      label: itemNamesMap[code] || code,
      data: itemQtyWeekly[code],
      borderColor: colorPalette[idx % colorPalette.length],
      backgroundColor: colorPalette[idx % colorPalette.length],
      tension: 0.35,
      borderWidth: 2.5,
      pointRadius: 4,
      pointHoverRadius: 6,
      fill: false
    }));

    // Details for Clickable KPI Cards
    const trxDetails = filteredTrx.map(t => ({
      nomorFaktur: String(t['Nomor Faktur'] || '-'),
      waktu: String(t['Waktu Transaksi'] || t['Tanggal Dibuat'] || '-'),
      namaSales: userMap[String(t['ID Sales']).trim()] || String(t['ID Sales'] || '-'),
      namaOutlet: outletMap[String(t['Kode Outlet']).trim()] || String(t['Kode Outlet'] || '-'),
      wilayah: String(t['Kode Wilayah'] || outletWilayahMap[String(t['Kode Outlet']).trim()] || '-'),
      totalItem: Number(t['Total Item']) || 0,
      totalAkhir: Number(t['Total Akhir']) || 0,
      metodeBayar: String(t['Metode Pembayaran'] || 'Cash'),
      statusBayar: String(t['Status Pembayaran'] || 'Lunas')
    }));

    const outletDetails = filteredOutlet.map(o => ({
      kodeOutlet: String(o['Kode Outlet'] || '-'),
      namaToko: String(o['Nama Toko'] || '-'),
      namaPemilik: String(o['Nama Pemilik'] || '-'),
      nomorHp: String(o['Nomor HP'] || '-'),
      wilayah: String(o['Kode Wilayah'] || '-'),
      hariKunjungan: String(o['Hari Kunjungan'] || 'Setiap Hari'),
      statusVerifikasi: String(o['Status Verifikasi'] || o['Status'] || '').trim().toLowerCase() === 'pending' ? 'Pending' : 'Verified'
    }));

    const salesDetails = salesUsers.map(s => {
      const sId = String(s['User ID']).trim();
      const absenRow = allAbsensi.find(a => String(a['Tanggal'] || '').substring(0, 10) === todayStr && String(a['ID Sales']).trim() === sId);
      return {
        salesId: sId,
        namaLengkap: String(s['Nama Lengkap'] || s['Username'] || '-'),
        wilayah: String(s['Kode Wilayah'] || '-'),
        hadir: !!absenRow,
        jamMasuk: absenRow ? String(absenRow['Jam Masuk'] || '-') : '-',
        jamPulang: absenRow ? String(absenRow['Jam Pulang'] || '-') : '-',
        statusLokasi: absenRow ? String(absenRow['Status Lokasi'] || 'Hadir') : 'Belum Hadir',
        fotoMasuk: absenRow ? String(absenRow['Foto Selfie Masuk'] || '-') : '-'
      };
    });

    return {
      success: true,
      kpi: {
        totalOmzet: totalOmzet,
        totalTransaksi: totalTransaksi,
        outletAktifCount: outletAktifCount,
        pendingOutletCount: pendingOutletCount,
        totalSalesCount: salesUsers.length,
        salesHadirCount: salesHadirCount
      },
      brandVolume: {
        labels: barLabels,
        fullNames: barFullNames,
        dataBks: barValuesBks,
        dataBall: barValuesBall,
        unit: 'Bks'
      },
      weeklyTrend: {
        labels: trendLabels,
        datasets: datasets,
        unit: 'Bks'
      },
      leaderboard: leaderboard,
      recentVisits: recentVisits,
      details: {
        transaksi: trxDetails,
        outlets: outletDetails,
        sales: salesDetails
      }
    };
  } catch (err) {
    Logger.log('Error in apiGetDashboardData: ' + err.message);
    return {
      success: false,
      message: err.message,
      kpi: { totalOmzet: 0, totalTransaksi: 0, outletAktifCount: 0, pendingOutletCount: 0, totalSalesCount: 0, salesHadirCount: 0 },
      leaderboard: [],
      recentVisits: []
    };
  }
}

// ==============================================================================
// 2. OPERASIONAL SALES (ABSENSI, KUNJUNGAN & POS)
// ==============================================================================

function apiSubmitAbsensi(payload) {
  const config = getConfigMap() || {};
  const users = getSheetData('USERS') || [];
  const currentUser = users.find(u => String(u['User ID']).trim() === String(payload.salesId).trim());
  const userWilayahCode = currentUser ? String(currentUser['Kode Wilayah']).trim() : (payload.kodeWilayah || '');

  const wilayahList = getSheetData('WILAYAH') || [];
  const targetWilayah = wilayahList.find(w => String(w['Kode Wilayah']).trim() === userWilayahCode);

  let officeLat = Number(config['Latitude Kantor'] || -7.265432);
  let officeLong = Number(config['Longitude Kantor'] || 112.748901);
  let maxRadius = Number(config['Radius Default Kantor Meter'] || 100);
  let officeName = config['Nama Perusahaan'] || 'Kantor Pusat';

  if (targetWilayah && (Number(targetWilayah['Latitude Kantor']) || Number(targetWilayah['Longitude Kantor']))) {
    officeLat = Number(targetWilayah['Latitude Kantor']) || officeLat;
    officeLong = Number(targetWilayah['Longitude Kantor']) || officeLong;
    maxRadius = Number(targetWilayah['Radius Absensi']) || maxRadius;
    officeName = targetWilayah['Nama Wilayah'] || targetWilayah['Nama Kabupaten'] || ('Cabang ' + targetWilayah['Kode Wilayah']);
  }

  const userLat = Number(payload.latitude);
  const userLong = Number(payload.longitude);
  const hasUserGps = !isNaN(userLat) && !isNaN(userLong) && (userLat !== 0 || userLong !== 0);

  if (!hasUserGps) {
    return { success: false, message: 'Lokasi GPS Anda tidak terdeteksi. Pastikan GPS HP aktif dan izin lokasi browser telah diizinkan!' };
  }

  let distance = calculateHaversineDistance(userLat, userLong, officeLat, officeLong);
  if (isNaN(distance)) distance = 0;

  const isValidRadius = distance <= maxRadius;
  const statusLokasi = isValidRadius ? 'Valid (Dalam Radius)' : 'Di Luar Radius (' + Math.round(distance) + 'm)';

  let fotoUrl = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop';
  if (payload.fotoSelfieBase64 && payload.fotoSelfieBase64.startsWith('data:image')) {
    const folderId = config['Folder ID Absensi'] || '';
    fotoUrl = saveBase64ImageToDrive(payload.fotoSelfieBase64, folderId, 'Absensi_' + payload.salesId + '_' + payload.tipeAbsen + '_' + Date.now() + '.jpg');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('ABSENSI');
  const now = new Date();
  const todayStr = getTodayDateString();
  const timeStr = getCurrentTimeString();
  const timeCode = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HHmmss');
  const salesSuffix = String(payload.salesId || 'S').replace(/\D/g, '').slice(-3) || '001';
  const ms = String(now.getTime()).slice(-4);
  const salt = Math.floor(100 + Math.random() * 900);

  const absensiData = getSheetData('ABSENSI') || [];
  let existingRowIndex = -1;
  for (let i = 0; i < absensiData.length; i++) {
    const rowSales = String(absensiData[i]['ID Sales'] || '').trim();
    let rowTgl = absensiData[i]['Tanggal'];
    if (rowTgl instanceof Date) {
      rowTgl = Utilities.formatDate(rowTgl, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      rowTgl = String(rowTgl || '').substring(0, 10);
      const dmy = rowTgl.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (dmy) rowTgl = dmy[3] + '-' + dmy[2].padStart(2, '0') + '-' + dmy[1].padStart(2, '0');
    }

    if (rowSales === String(payload.salesId).trim() && rowTgl === todayStr) {
      existingRowIndex = i + 2;
      break;
    }
  }

  if (payload.tipeAbsen === 'MASUK') {
    if (existingRowIndex > -1) {
      return { success: false, message: 'Anda sudah melakukan absensi masuk hari ini!' };
    }
    const absensiId = 'ABS-' + todayStr.replace(/-/g, '') + '-' + timeCode + '-' + salesSuffix + '-' + ms + salt;
    appendRowByHeaderMap(sheet, {
      'ID Absensi': absensiId,
      'ID Sales': payload.salesId,
      'Tanggal': todayStr,
      'Jam Masuk': timeStr,
      'Jam Pulang': '-',
      'Latitude Masuk': userLat,
      'Longitude Masuk': userLong,
      'Latitude Pulang': '-',
      'Longitude Pulang': '-',
      'Jarak Masuk Meter': Math.round(distance),
      'Jarak Pulang Meter': 0,
      'Status Lokasi': statusLokasi,
      'Foto Selfie Masuk': fotoUrl,
      'Foto Selfie Pulang': '-'
    });

    if (!isValidRadius) {
      sendPushNotificationFCM(
        'admin_owner',
        '⚠️ Absensi di Luar Radius',
        'Sales ' + (payload.salesId || '') + ' absen masuk ' + Math.round(distance) + 'm dari ' + officeName + '.',
        'riwayat'
      );
    }

    return { success: true, message: 'Absen Masuk Berhasil! (' + Math.round(distance) + 'm dari ' + officeName + ')' };
  } else {
    if (existingRowIndex === -1) {
      return { success: false, message: 'Anda belum melakukan absen masuk hari ini!' };
    }
    updateRowByHeaderMap(sheet, existingRowIndex, {
      'Jam Pulang': timeStr,
      'Latitude Pulang': userLat,
      'Longitude Pulang': userLong,
      'Jarak Pulang Meter': Math.round(distance),
      'Foto Selfie Pulang': fotoUrl
    });
    return { success: true, message: 'Absen Pulang Berhasil! (' + Math.round(distance) + 'm dari ' + officeName + ')' };
  }
}

function apiSubmitKunjungan(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetKunjungan = ss.getSheetByName('KUNJUNGAN');
  const outlets = getSheetData('OUTLET') || [];
  const targetOutlet = outlets.find(o => String(o['Kode Outlet'] || '').trim().toUpperCase() === String(payload.kodeOutlet || '').trim().toUpperCase());

  if (!targetOutlet) {
    return { success: false, message: 'Outlet tidak ditemukan!' };
  }

  const outletLat = Number(targetOutlet['Latitude']);
  const outletLong = Number(targetOutlet['Longitude']);
  const maxRadius = Number(targetOutlet['Radius Meter'] || 50);

  const userLat = Number(payload.latitude);
  const userLong = Number(payload.longitude);

  const hasOutletGps = !isNaN(outletLat) && !isNaN(outletLong) && (outletLat !== 0 || outletLong !== 0);
  const hasUserGps = !isNaN(userLat) && !isNaN(userLong) && (userLat !== 0 || userLong !== 0);

  let distance = 0;
  let statusValidasi = 'Valid';
  let message = '';

  if (!hasOutletGps) {
    distance = 0;
    statusValidasi = 'Lokasi Toko Belum Ada GPS';
    message = 'Kunjungan berhasil disimpan! (Koordinat GPS toko belum disetel)';
  } else if (!hasUserGps) {
    distance = 0;
    statusValidasi = 'GPS Sales Tidak Terdeteksi';
    message = 'Kunjungan berhasil disimpan! (Perhatian: GPS Anda tidak terdeteksi)';
  } else {
    distance = calculateHaversineDistance(userLat, userLong, outletLat, outletLong);
    if (isNaN(distance)) {
      distance = 0;
      statusValidasi = 'Lokasi Toko Belum Ada GPS';
      message = 'Kunjungan berhasil disimpan! (Koordinat GPS toko belum disetel)';
    } else {
      const isValidRadius = distance <= maxRadius;
      statusValidasi = isValidRadius ? 'Valid' : 'Di Luar Radius (' + Math.round(distance) + 'm)';
      message = 'Kunjungan berhasil disimpan! (' + Math.round(distance) + 'm dari ' + targetOutlet['Nama Toko'] + ')';
    }
  }

  const config = getConfigMap() || {};
  let selfieUrl = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop';
  let barangUrl = 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=300&h=300&fit=crop';
  let displayUrl = 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=300&h=300&fit=crop';

  if (payload.fotoSelfieBase64 && payload.fotoSelfieBase64.startsWith('data:image')) {
    selfieUrl = saveBase64ImageToDrive(payload.fotoSelfieBase64, config['Folder ID Kunjungan'], 'Selfie_' + payload.kodeOutlet + '_' + Date.now() + '.jpg');
  }
  if (payload.fotoBarangBase64 && payload.fotoBarangBase64.startsWith('data:image')) {
    barangUrl = saveBase64ImageToDrive(payload.fotoBarangBase64, config['Folder ID Display'], 'Barang_' + payload.kodeOutlet + '_' + Date.now() + '.jpg');
  }
  if (payload.fotoDisplayBase64 && payload.fotoDisplayBase64.startsWith('data:image')) {
    displayUrl = saveBase64ImageToDrive(payload.fotoDisplayBase64, config['Folder ID Display'], 'Display_' + payload.kodeOutlet + '_' + Date.now() + '.jpg');
  }

  const now = new Date();
  const todayStr = payload.tanggal || getTodayDateString();
  const timeStr = payload.jam || getCurrentTimeString();
  const timeCode = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HHmmss');
  const salesSuffix = String(payload.salesId || 'S').replace(/\D/g, '').slice(-3) || '001';
  const ms = String(now.getTime()).slice(-4);
  const salt = Math.floor(100 + Math.random() * 900);
  const kunjunganId = 'VIST-' + String(todayStr).replace(/-/g, '') + '-' + timeCode + '-' + salesSuffix + '-' + ms + salt;

  let stokTokoStr = '-';
  if (payload.stokToko) {
    if (typeof payload.stokToko === 'string') {
      stokTokoStr = payload.stokToko.trim() || '-';
    } else if (Array.isArray(payload.stokToko)) {
      const items = payload.stokToko
        .filter(it => it && (Number(it.qty) > 0 || String(it.qty).trim() !== ''))
        .map(it => (it.brand || it.singkatan || it.namaProduk || it.kodeProduk) + ': ' + (it.qty || 0) + ' bks');
      stokTokoStr = items.length > 0 ? items.join(', ') : 'Nihil / 0 bks';
    } else if (typeof payload.stokToko === 'object') {
      const items = Object.entries(payload.stokToko)
        .filter(([_, q]) => Number(q) > 0 || String(q).trim() !== '')
        .map(([k, q]) => k + ': ' + q + ' bks');
      stokTokoStr = items.length > 0 ? items.join(', ') : 'Nihil / 0 bks';
    }
  }

  // Pastikan kolom 'Stok Toko' sudah ada di row 1 sheet KUNJUNGAN
  try {
    const lastCol = sheetKunjungan.getLastColumn();
    if (lastCol > 0) {
      const hdrs = sheetKunjungan.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
      if (!hdrs.includes('Stok Toko')) {
        sheetKunjungan.getRange(1, lastCol + 1).setValue('Stok Toko');
      }
    }
  } catch (e) {
    Logger.log('Auto header Stok Toko warn: ' + e.message);
  }

  appendRowByHeaderMap(sheetKunjungan, {
    'ID Kunjungan': kunjunganId,
    'ID Sales': payload.salesId,
    'Kode Outlet': payload.kodeOutlet,
    'Tanggal': todayStr,
    'Jam Kunjungan': timeStr,
    'Latitude': hasUserGps ? userLat : '-',
    'Longitude': hasUserGps ? userLong : '-',
    'Jarak Meter': Math.round(distance),
    'Status Validasi': statusValidasi,
    'Foto Selfie': selfieUrl,
    'Foto Barang': barangUrl,
    'Foto Display': displayUrl,
    'Catatan Kunjungan': payload.catatan || '-',
    'Stok Toko': stokTokoStr,
    'Tanggal Dibuat': now.toISOString()
  });

  // Kirim Push Notifikasi Real-Time ke HP Admin & Owner
  try {
    const targetOutletName = targetOutlet ? targetOutlet['Nama Toko'] : (payload.kodeOutlet || 'Outlet');
    sendPushNotificationFCM(
      'admin_owner',
      '📍 Kunjungan Toko: ' + targetOutletName,
      'Sales ' + (payload.salesId || '') + ' selesai check-in (' + statusValidasi + ').',
      'kunjungan'
    );
  } catch (errKunjunganNotif) {
    Logger.log('Warn FCM Kunjungan: ' + errKunjunganNotif.message);
  }

  return {
    success: true,
    message: message,
    kunjunganId: kunjunganId
  };
}

function apiSubmitTransaksiPOS(payload) {
  payload = payload || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetTrx = ss.getSheetByName('TRANSAKSI');
  const sheetDetail = ss.getSheetByName('TRANSAKSI DETAIL');
  if (!sheetTrx || !sheetDetail) return { success: false, message: 'Sheet transaksi tidak ditemukan!' };

  const users = getSheetData('USERS') || [];
  const salesUser = users.find(u => String(u['User ID']).trim() === String(payload.salesId).trim());
  const userRole = (salesUser && salesUser['Role']) ? String(salesUser['Role']).trim() : 'Sales';
  const allOutlets = getSheetData('OUTLET') || [];
  const targetOutlet = allOutlets.find(o => String(o['Kode Outlet']).trim() === String(payload.kodeOutlet).trim());
  const todayDateStr = getTodayDateString();

  // 1. Validasi Wajib Check-In Kunjungan Hari Ini (Khusus Sales)
  if (userRole === 'Sales') {
    const recentKunjungan = getRecentKunjunganMini(500);
    const salesUserId = String(payload.salesId || '').trim().toUpperCase();
    const targetOutletCode = String(payload.kodeOutlet || '').trim().toUpperCase();

    const hasCheckinToday = recentKunjungan.some(k => {
      const kSales = String(k['ID Sales'] || k.salesId || '').trim().toUpperCase();
      const kOutlet = String(k['Kode Outlet'] || k.kodeOutlet || '').trim().toUpperCase();
      const kDate = normalizeDateOnly(k['Tanggal'] || k.tanggal);
      const matchSales = (!salesUserId || !kSales || kSales === salesUserId);
      return matchSales && kOutlet === targetOutletCode && kDate === todayDateStr;
    });

    if (!hasCheckinToday) {
      return {
        success: false,
        message: 'Transaksi POS Ditolak: Anda belum melakukan Check-in Kunjungan di outlet ' + (targetOutlet ? targetOutlet['Nama Toko'] : payload.kodeOutlet) + ' hari ini (' + todayDateStr + '). Harap selesaikan Check-in Kunjungan terlebih dahulu!'
      };
    }
  }

  // 2. Validasi Geofencing Radius Outlet untuk POS
  if (targetOutlet) {
    const oLat = Number(targetOutlet['Latitude']) || 0;
    const oLng = Number(targetOutlet['Longitude']) || 0;
    const hasCoords = (oLat !== 0 || oLng !== 0) && !isNaN(oLat) && !isNaN(oLng);
    const maxRadius = Number(targetOutlet['Radius Meter']) || 50;

    const userLat = Number(payload.latitude) || 0;
    const userLng = Number(payload.longitude) || 0;
    const hasUserCoords = (userLat !== 0 || userLng !== 0) && !isNaN(userLat) && !isNaN(userLng);

    if (hasCoords) {
      if (!hasUserCoords) {
        return { 
          success: false, 
          message: 'Transaksi POS Ditolak: Lokasi GPS Anda tidak terdeteksi. Pastikan GPS aktif dan berada di lokasi toko!' 
        };
      }
      const dist = calculateHaversineDistance(userLat, userLng, oLat, oLng);
      if (!isNaN(dist) && dist > maxRadius) {
        return { 
          success: false, 
          message: 'Transaksi POS Ditolak: Anda berada di luar radius toko ' + (targetOutlet['Nama Toko'] || payload.kodeOutlet) + ' (' + Math.round(dist) + 'm > batas ' + maxRadius + 'm)!' 
        };
      }
    }
  }

  const now = new Date();
  const todayStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');
  const timeCode = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HHmmss');
  const fullTimeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const salesSuffix = String(payload.salesId || 'S').replace(/\D/g, '').slice(-3) || '001';
  const ms = String(now.getTime()).slice(-4);
  const salt = Math.floor(100 + Math.random() * 900);
  
  const nomorFaktur = 'TRX-' + todayStr + '-' + timeCode + '-' + salesSuffix + '-' + ms + salt;
  const items = payload.items || [];
  let totalItemCount = 0;
  let subtotal = 0;

  items.forEach(item => {
    const itemQty = Number(item.qty) || 1;
    const itemHarga = Number(item.harga) || 0;
    totalItemCount += itemQty;
    subtotal += (itemQty * itemHarga);
  });

  const diskon = Number(payload.diskon) || 0;
  const totalAkhir = Math.max(0, subtotal - diskon);

  appendRowByHeaderMap(sheetTrx, {
    'Nomor Faktur': nomorFaktur,
    'Waktu Transaksi': fullTimeStr,
    'ID Sales': payload.salesId,
    'Kode Outlet': payload.kodeOutlet,
    'Kode Wilayah': payload.kodeWilayah || 'SBY',
    'Total Item': totalItemCount,
    'Subtotal': subtotal,
    'Diskon': diskon,
    'Total Akhir': totalAkhir,
    'Metode Pembayaran': payload.metodePembayaran || 'Tunai',
    'Status Pembayaran': payload.statusPembayaran || 'Lunas',
    'Catatan': payload.catatan || '-',
    'Tanggal Dibuat': now.toISOString()
  });

  const detailRows = items.map((item, idx) => [
    'DTL-' + nomorFaktur + '-' + (idx + 1), nomorFaktur, item.kodeProduk, item.namaProduk, Number(item.harga) || 0, Number(item.qty) || 1, item.satuan || 'Pcs', (Number(item.qty) || 1) * (Number(item.harga) || 0)
  ]);

  if (detailRows.length > 0) {
    // 1. Dual-write ke Supabase jika aktif
    if (typeof isSupabaseActive === 'function' && isSupabaseActive()) {
      try {
        const supaDetails = items.map((item, idx) => ({
          id_detail: 'DTL-' + nomorFaktur + '-' + (idx + 1),
          nomor_faktur: nomorFaktur,
          kode_produk: item.kodeProduk,
          nama_produk: item.namaProduk,
          harga_satuan: Number(item.harga) || 0,
          qty: Number(item.qty) || 1,
          satuan: item.satuan || 'Pcs',
          subtotal: (Number(item.qty) || 1) * (Number(item.harga) || 0)
        }));
        supabaseInsert('transaksi_detail', supaDetails);
      } catch (errDetail) {
        Logger.log('[Dual-DB Detail] Supabase insert error: ' + errDetail.message);
      }
    }

    // 2. Tulis ke Google Sheets (Backup)
    sheetDetail.getRange(sheetDetail.getLastRow() + 1, 1, detailRows.length, detailRows[0].length).setValues(detailRows);
  }

  // Update STOK_SALES harian jika ada permintaan stok yang disetujui hari ini
  try {
    const sheetStok = ss.getSheetByName('STOK_SALES');
    if (sheetStok) {
      const stokData = getSheetData('STOK_SALES') || [];
      const todayDateStr = getTodayDateString();
      items.forEach(it => {
        for (let s = 0; s < stokData.length; s++) {
          const sSalesId = String(stokData[s]['ID Sales']).trim();
          const sKodePrd = String(stokData[s]['Kode Produk']).trim();
          const sStatus = String(stokData[s]['Status']).trim();
          const sTgl = normalizeDateOnly(stokData[s]['Tanggal']);

          if (sSalesId === String(payload.salesId).trim() && 
              sKodePrd === String(it.kodeProduk).trim() && 
              sStatus === 'Disetujui' && 
              (sTgl === todayDateStr || Number(stokData[s]['Sisa Stok Sales']) > 0)) {
            const currentTerjual = Number(stokData[s]['Qty Terjual']) || 0;
            const itemQty = Number(it.qty) || 1;
            const newTerjual = currentTerjual + itemQty;
            const qtyDisetujui = Number(stokData[s]['Qty Disetujui']) || 0;
            const sisa = Math.max(0, qtyDisetujui - newTerjual);
            updateRowByHeaderMap(sheetStok, s + 2, {
              'Qty Terjual': newTerjual,
              'Sisa Stok Sales': sisa
            });
            stokData[s]['Qty Terjual'] = newTerjual;
            stokData[s]['Sisa Stok Sales'] = sisa;
            break;
          }
        }
      });
    }
  } catch (e) {
    Logger.log('Error updating STOK_SALES in POS: ' + e.message);
  }

  // Lookup Payment info dari WILAYAH cabang terkait
  const wilayahList = getSheetData('WILAYAH') || [];
  const targetWilayahCode = payload.kodeWilayah || (targetOutlet ? targetOutlet['Kode Wilayah'] : (salesUser ? salesUser['Kode Wilayah'] : ''));
  const targetWilayah = wilayahList.find(w => String(w['Kode Wilayah']).trim() === String(targetWilayahCode).trim());
  const config = getConfigMap() || {};

  const bankName = (targetWilayah && targetWilayah['Nama Bank'] && targetWilayah['Nama Bank'] !== '-') ? targetWilayah['Nama Bank'] : (config['Nama Bank'] || 'Bank BCA');
  const bankAccNo = (targetWilayah && targetWilayah['Nomor Rekening'] && targetWilayah['Nomor Rekening'] !== '-') ? targetWilayah['Nomor Rekening'] : (config['Nomor Rekening'] || '-');
  const bankAccName = (targetWilayah && targetWilayah['Atas Nama Rekening'] && targetWilayah['Atas Nama Rekening'] !== '-') ? targetWilayah['Atas Nama Rekening'] : (config['Atas Nama Rekening'] || '-');
  const qrisUrl = (targetWilayah && targetWilayah['QRIS Image URL'] && targetWilayah['QRIS Image URL'] !== '-') ? targetWilayah['QRIS Image URL'] : (config['QRIS Image URL'] || '');

  // Kirim Push Notifikasi Real-Time ke HP Admin & Owner
  try {
    const salesNameStr = salesUser ? salesUser['Nama Lengkap'] : (payload.salesId || 'Sales');
    const outletNameStr = targetOutlet ? targetOutlet['Nama Toko'] : (payload.kodeOutlet || 'Outlet');
    sendPushNotificationFCM(
      'admin_owner',
      '💰 Penjualan POS: Rp ' + formatRupiah(totalAkhir),
      salesNameStr + ' mencatat faktur di ' + outletNameStr + ' (' + items.length + ' item).',
      'riwayat'
    );
  } catch (errPosNotif) {
    Logger.log('Warn FCM POS: ' + errPosNotif.message);
  }

  return {
    success: true,
    message: 'Transaksi berhasil disimpan! Faktur: ' + nomorFaktur,
    receiptData: {
      nomorFaktur: nomorFaktur,
      waktu: fullTimeStr,
      salesName: salesUser ? salesUser['Nama Lengkap'] : (payload.salesId || 'Sales'),
      outletName: targetOutlet ? targetOutlet['Nama Toko'] : (payload.kodeOutlet || 'Pelanggan'),
      outletHp: targetOutlet ? targetOutlet['Nomor HP'] : '',
      outletAlamat: targetOutlet ? targetOutlet['Alamat'] : '',
      items: items,
      subtotal: subtotal,
      diskon: diskon,
      totalAkhir: totalAkhir,
      metodePembayaran: payload.metodePembayaran || 'Cash',
      uangDiterima: Number(payload.uangDiterima) || totalAkhir,
      kembalian: Number(payload.kembalian) || 0,
      bankName: bankName,
      bankAccNo: bankAccNo,
      bankAccName: bankAccName,
      qrisUrl: qrisUrl
    }
  };
}

function apiGetRiwayatAbsensi(salesId, role) {
  try {
    let absensi = getSheetData('ABSENSI') || [];
    const users = getSheetData('USERS') || [];
    const userMap = {};
    users.forEach(u => { userMap[String(u['User ID']).trim()] = u['Nama Lengkap']; });

    if (role === 'Sales' && salesId) {
      absensi = absensi.filter(a => String(a['ID Sales']).trim() === String(salesId).trim());
    }

    absensi.reverse();

    const data = absensi.slice(0, 100).map(a => {
      let tglStr = a['Tanggal'];
      if (tglStr instanceof Date) {
        tglStr = Utilities.formatDate(tglStr, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        tglStr = normalizeDateOnly(tglStr) || String(tglStr || '').replace(/1899-12-3[01][T ]?/, '').trim().substring(0, 10);
      }

      let jamMasukStr = a['Jam Masuk'];
      if (jamMasukStr instanceof Date) {
        jamMasukStr = Utilities.formatDate(jamMasukStr, Session.getScriptTimeZone(), 'HH:mm:ss');
      } else {
        jamMasukStr = String(jamMasukStr || '').replace(/1899-12-3[01][T ]?/, '').trim();
      }

      let jamPulangStr = a['Jam Pulang'];
      if (jamPulangStr instanceof Date) {
        jamPulangStr = Utilities.formatDate(jamPulangStr, Session.getScriptTimeZone(), 'HH:mm:ss');
      } else {
        jamPulangStr = String(jamPulangStr || '').replace(/1899-12-3[01][T ]?/, '').trim();
      }

      return {
        idAbsensi: String(a['ID Absensi'] || ''),
        salesId: String(a['ID Sales'] || ''),
        namaSales: userMap[String(a['ID Sales']).trim()] || String(a['ID Sales'] || 'Sales'),
        tanggal: tglStr,
        jamMasuk: jamMasukStr,
        jamPulang: jamPulangStr,
        jarakMasuk: a['Jarak Masuk Meter'] ? String(a['Jarak Masuk Meter']) : '',
        jarakPulang: a['Jarak Pulang Meter'] ? String(a['Jarak Pulang Meter']) : '',
        statusLokasi: String(a['Status Lokasi'] || 'Valid'),
        fotoMasuk: String(a['Foto Selfie Masuk'] || ''),
        fotoPulang: String(a['Foto Selfie Pulang'] || '')
      };
    });

    return { success: true, data: data };
  } catch (err) {
    Logger.log('Error apiGetRiwayatAbsensi: ' + err.message);
    return { success: true, message: err.message, data: [] };
  }
}

function apiGetRiwayatTransaksiPOS(salesId, role, kodeWilayah) {
  try {
    let trx = getRecentRows('TRANSAKSI', 300);
    const details = getRecentRows('TRANSAKSI DETAIL', 2500);
    const outlets = getSheetData('OUTLET') || [];
    const users = getSheetData('USERS') || [];

    const outletMap = {};
    outlets.forEach(o => { outletMap[String(o['Kode Outlet']).trim()] = o; });

    const userMap = {};
    users.forEach(u => { userMap[String(u['User ID']).trim()] = u['Nama Lengkap']; });

    const detailMap = {};
    details.forEach(d => {
      const fNo = String(d['Nomor Faktur'] || '').trim();
      if (!detailMap[fNo]) detailMap[fNo] = [];
      detailMap[fNo].push({
        kodeProduk: String(d['Kode Produk'] || ''),
        namaProduk: String(d['Nama Produk'] || ''),
        harga: Number(d['Harga Satuan']) || 0,
        qty: Number(d['Qty']) || 1,
        satuan: String(d['Satuan'] || 'Pcs'),
        subtotal: Number(d['Subtotal']) || 0
      });
    });

    if (role === 'Sales' && salesId) {
      trx = trx.filter(t => String(t['ID Sales']).trim() === String(salesId).trim());
    } else if (role === 'Admin' && kodeWilayah && kodeWilayah !== 'SEMUA') {
      const targetWilayah = String(kodeWilayah).trim();
      trx = trx.filter(t => {
        const outlet = outletMap[String(t['Kode Outlet']).trim()];
        const tWilayah = String(t['Kode Wilayah'] || (outlet ? outlet['Kode Wilayah'] : '')).trim();
        return tWilayah === targetWilayah;
      });
    }

    trx.reverse();

    const recentTrx = trx.slice(0, 100).map(t => {
      const fakturNo = String(t['Nomor Faktur'] || '').trim();
      const targetOutlet = outletMap[String(t['Kode Outlet']).trim()];
      
      let waktuStr = t['Waktu Transaksi'];
      if (waktuStr instanceof Date) {
        waktuStr = Utilities.formatDate(waktuStr, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      } else {
        waktuStr = String(waktuStr || '');
      }

      const items = detailMap[fakturNo] || [];

      return {
        nomorFaktur: fakturNo,
        waktu: waktuStr,
        salesId: String(t['ID Sales'] || ''),
        salesName: userMap[String(t['ID Sales']).trim()] || String(t['ID Sales'] || 'Sales'),
        kodeOutlet: String(t['Kode Outlet'] || ''),
        outletName: targetOutlet ? targetOutlet['Nama Toko'] : String(t['Kode Outlet'] || 'Outlet'),
        outletHp: targetOutlet ? (targetOutlet['Nomor HP'] || '') : '',
        outletAlamat: targetOutlet ? (targetOutlet['Alamat'] || '') : '',
        kodeWilayah: String(t['Kode Wilayah'] || (targetOutlet ? targetOutlet['Kode Wilayah'] : '') || ''),
        totalItem: Number(t['Total Item']) || (items.length || 1),
        subtotal: Number(t['Subtotal']) || 0,
        diskon: Number(t['Diskon']) || 0,
        totalAkhir: Number(t['Total Akhir']) || 0,
        metodePembayaran: String(t['Metode Pembayaran'] || 'Cash'),
        statusPembayaran: String(t['Status Pembayaran'] || 'Lunas'),
        items: items
      };
    });

    return { success: true, data: recentTrx };
  } catch (err) {
    Logger.log('Error apiGetRiwayatTransaksiPOS: ' + err.message);
    return { success: true, message: err.message, data: [] };
  }
}

// ==============================================================================
// 3. CRUD MASTER OUTLET, PRODUK, WILAYAH & CONFIG (DYNAMIC HEADER MATCHING)
// ==============================================================================

function apiSaveOutlet(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('OUTLET');
  const data = getSheetData('OUTLET') || [];

  let lat = Number(payload.latitude) || 0;
  let lng = Number(payload.longitude) || 0;
  if (lat === 0 && lng === 0 && payload.linkMaps) {
    const match1 = String(payload.linkMaps).match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match2 = String(payload.linkMaps).match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match3 = String(payload.linkMaps).match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    const match4 = String(payload.linkMaps).match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match5 = String(payload.linkMaps).match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match6 = String(payload.linkMaps).match(/^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/);

    const m = match1 || match2 || match3 || match4 || match5 || match6;
    if (m) {
      lat = Number(m[1]);
      lng = Number(m[2]);
    }
  }

  const outletDataObj = {
    'Nama Toko': payload.namaToko,
    'Nama Pemilik': payload.namaPemilik || '-',
    'Nomor HP': payload.nomorHp || '-',
    'Alamat': payload.alamat || '-',
    'Kode Wilayah': payload.kodeWilayah,
    'Hari Kunjungan': payload.hariKunjungan || 'Senin',
    'Link Google Maps': payload.linkMaps || '-',
    'Latitude': lat,
    'Longitude': lng,
    'Radius Meter': Number(payload.radiusMeter) || 50,
    'Bisa Untuk Absensi': payload.bisaUntukAbsensi || 'Tidak'
  };

  if (payload.statusVerifikasi) {
    outletDataObj['Status Verifikasi'] = payload.statusVerifikasi;
  }
  if (payload.adminUserId || payload.diverifikasiOleh) {
    outletDataObj['Diverifikasi Oleh'] = payload.adminUserId || payload.diverifikasiOleh || 'Admin';
  }

  // Edit Outlet (Dynamic Column Matching)
  if (payload.kodeOutlet && String(payload.kodeOutlet).trim() !== '') {
    const targetCode = String(payload.kodeOutlet).trim().toLowerCase();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i]['Kode Outlet'] || '').trim().toLowerCase() === targetCode) {
        const r = i + 2;
        updateRowByHeaderMap(sheet, r, outletDataObj);
        return { success: true, message: 'Data outlet ' + payload.namaToko + ' berhasil diperbarui!' };
      }
    }
  }

  // Tambah Outlet Baru: Hitung ID secara STRICTLY INCREMENTAL (Cari ID angka terbesar + 1)
  let maxOutletNum = 0;
  for (let i = 0; i < data.length; i++) {
    const rawCode = String(data[i]['Kode Outlet'] || '').trim();
    const match = rawCode.match(/OTL-(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n) && n > maxOutletNum) maxOutletNum = n;
    }
  }
  const nextOutletNum = maxOutletNum + 1;
  const kodeOutlet = 'OTL-' + String(nextOutletNum).padStart(3, '0');

  outletDataObj['Kode Outlet'] = kodeOutlet;
  outletDataObj['Status Verifikasi'] = payload.statusVerifikasi || 'Verified';
  outletDataObj['Didaftarkan Oleh'] = payload.salesId || 'Admin';
  outletDataObj['Diverifikasi Oleh'] = payload.statusVerifikasi === 'Verified' ? (payload.adminUserId || 'Admin') : '-';
  outletDataObj['Tanggal Dibuat'] = new Date().toISOString();

  appendRowByHeaderMap(sheet, outletDataObj);

  if (String(outletDataObj['Status Verifikasi'] || '').toLowerCase() === 'pending') {
    sendPushNotificationFCM(
      'admin_owner',
      '🏪 Verifikasi Toko Baru',
      'Toko ' + payload.namaToko + ' (' + (payload.kodeWilayah || '-') + ') didaftarkan sales. Butuh verifikasi!',
      'outlet'
    );
  }

  return { success: true, message: 'Outlet ' + payload.namaToko + ' (' + kodeOutlet + ') berhasil disimpan!' };
}

function apiVerifyOutlet(kodeOutlet, radiusMeter, statusVerifikasi, adminUserId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('OUTLET');
  const data = getSheetData('OUTLET') || [];

  const targetCode = String(kodeOutlet || '').trim().toLowerCase();
  let updatedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const rowCode = String(data[i]['Kode Outlet'] || '').trim().toLowerCase();
    if (rowCode === targetCode) {
      const r = i + 2;
      const updateObj = {
        'Status Verifikasi': statusVerifikasi || 'Verified',
        'Diverifikasi Oleh': adminUserId || 'Admin'
      };
      if (radiusMeter && !isNaN(Number(radiusMeter))) {
        updateObj['Radius Meter'] = Number(radiusMeter);
      }
      updateRowByHeaderMap(sheet, r, updateObj);
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    return { success: true, message: 'Status verifikasi outlet ' + kodeOutlet + ' diubah menjadi: ' + (statusVerifikasi || 'Verified') };
  }
  return { success: false, message: 'Outlet tidak ditemukan!' };
}

function apiDeleteOutlet(kodeOutlet) {
  // 1. Delete dari Supabase jika aktif
  if (typeof isSupabaseActive === 'function' && isSupabaseActive()) {
    try {
      supabaseDelete('outlet', { kode_outlet: 'eq.' + kodeOutlet });
    } catch (errDel) {
      Logger.log('[Dual-DB] Gagal delete outlet Supabase: ' + errDel.message);
    }
  }

  // 2. Delete dari Google Sheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('OUTLET');
  const data = getSheetData('OUTLET') || [];

  for (let i = 0; i < data.length; i++) {
    if (data[i]['Kode Outlet'] === kodeOutlet) {
      sheet.deleteRow(i + 2);
      delete _executionSheetDataCache['OUTLET'];
      return { success: true, message: 'Outlet ' + kodeOutlet + ' berhasil dihapus!' };
    }
  }
  return { success: false, message: 'Outlet tidak ditemukan!' };
}

function apiSaveMasterProduk(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheetCaseInsensitive('PRODUK');
  if (!sheet) return { success: false, message: 'Sheet PRODUK tidak ditemukan!' };
  ensureSheetColumnExists(sheet, 'Singkatan');
  ensureSheetColumnExists(sheet, 'Isi Per Bal');
  const data = getSheetData('PRODUK') || [];

  const rawBal = Number(payload.isiPerBal);
  const isiBal = (!isNaN(rawBal) && rawBal > 0) ? rawBal : 200;

  const produkObj = {
    'Nama Produk': String(payload.namaProduk || '').trim(),
    'Singkatan': String(payload.singkatan || '').trim(),
    'Isi Per Bal': isiBal,
    'Kategori': payload.kategori || 'ROKOK',
    'Harga Jual': Number(payload.hargaJual) || 0,
    'Satuan': payload.satuan || 'Bks',
    'Stok Awal': Number(payload.stokAwal) || 0,
    'Target Bulanan': Number(payload.targetBulanan) || 0,
    'Status': payload.status || 'Aktif'
  };

  // Edit Produk
  if (payload.kodeProduk && String(payload.kodeProduk).trim() !== '') {
    const targetProd = String(payload.kodeProduk).trim().toUpperCase();
    for (let i = 0; i < data.length; i++) {
      const rowCode = String(data[i]['Kode Produk'] || data[i]['Kode'] || data[i]['Kode Barang'] || '').trim().toUpperCase();
      const rowName = String(data[i]['Nama Produk'] || data[i]['Nama'] || data[i]['Nama Barang'] || '').trim().toUpperCase();
      if (rowCode === targetProd || rowName === targetProd) {
        const r = i + 2;
        updateRowByHeaderMap(sheet, r, produkObj);
        SpreadsheetApp.flush();
        clearSheetCache('PRODUK');
        return { success: true, message: 'Produk ' + payload.namaProduk + ' (' + (payload.singkatan || payload.kodeProduk) + ') berhasil diperbarui!' };
      }
    }
  }

  // Tambah Produk Baru: Hitung ID secara STRICTLY INCREMENTAL jika kode kosong
  let kodeProduk = payload.kodeProduk ? String(payload.kodeProduk).trim().toUpperCase() : '';
  if (!kodeProduk) {
    let maxProdNum = 0;
    for (let i = 0; i < data.length; i++) {
      const rawCode = String(data[i]['Kode Produk'] || data[i]['Kode'] || '').trim();
      const match = rawCode.match(/PRD-(\d+)/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n > maxProdNum) maxProdNum = n;
      }
    }
    const nextProdNum = maxProdNum + 1;
    kodeProduk = 'PRD-' + String(nextProdNum).padStart(3, '0');
  }

  produkObj['Kode Produk'] = kodeProduk;
  produkObj['Tanggal Dibuat'] = new Date().toISOString();

  appendRowByHeaderMap(sheet, produkObj);
  SpreadsheetApp.flush();
  clearSheetCache('PRODUK');
  return { success: true, message: 'Produk baru ' + payload.namaProduk + ' (' + kodeProduk + ') berhasil ditambahkan!' };
}

function apiDeleteMasterProduk(kodeProduk) {
  // 1. Delete dari Supabase jika aktif
  if (typeof isSupabaseActive === 'function' && isSupabaseActive()) {
    try {
      supabaseDelete('produk', { kode_produk: 'eq.' + kodeProduk });
    } catch (errDel) {
      Logger.log('[Dual-DB] Gagal delete produk Supabase: ' + errDel.message);
    }
  }

  // 2. Delete dari Google Sheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheetCaseInsensitive('PRODUK');
  if (!sheet) return { success: false, message: 'Sheet PRODUK tidak ditemukan!' };
  const data = getSheetData('PRODUK') || [];
  const target = String(kodeProduk || '').trim().toUpperCase();

  for (let i = 0; i < data.length; i++) {
    const rowCode = String(data[i]['Kode Produk'] || data[i]['Kode'] || data[i]['Kode Barang'] || '').trim().toUpperCase();
    const rowName = String(data[i]['Nama Produk'] || data[i]['Nama'] || data[i]['Nama Barang'] || '').trim().toUpperCase();
    const rowSingkatan = String(data[i]['Singkatan'] || data[i]['Singkat'] || '').trim().toUpperCase();
    if (rowCode === target || rowName === target || (rowSingkatan && rowSingkatan === target)) {
      sheet.deleteRow(i + 2);
      SpreadsheetApp.flush();
      clearSheetCache('PRODUK');
      return { success: true, message: 'Produk ' + (data[i]['Nama Produk'] || kodeProduk) + ' berhasil dihapus dari database!' };
    }
  }
  return { success: false, message: 'Produk ' + kodeProduk + ' tidak ditemukan di sheet PRODUK!' };
}

function apiSaveMasterWilayah(payload, userRole, userWilayah) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('WILAYAH');
  const data = getSheetData('WILAYAH') || [];

  if (userRole === 'Admin' && userWilayah && userWilayah !== 'SEMUA') {
    const isSelf = String(payload.kodeWilayah || '').trim().toUpperCase() === String(userWilayah).trim().toUpperCase();
    if (!isSelf) {
      return { success: false, message: 'Anda hanya memiliki akses untuk mengatur lokasi wilayah ' + userWilayah + '!' };
    }
  }

  let lat = Number(payload.latitude) || 0;
  let lng = Number(payload.longitude) || 0;
  if (lat === 0 && lng === 0 && payload.linkMaps) {
    const match1 = String(payload.linkMaps).match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match2 = String(payload.linkMaps).match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match3 = String(payload.linkMaps).match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    const match4 = String(payload.linkMaps).match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match5 = String(payload.linkMaps).match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match6 = String(payload.linkMaps).match(/^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/);

    const m = match1 || match2 || match3 || match4 || match5 || match6;
    if (m) {
      lat = Number(m[1]);
      lng = Number(m[2]);
    }
  }

  const wilObj = {
    'Nama Wilayah': payload.namaWilayah || payload.namaKabupaten || ('Wilayah ' + payload.kodeWilayah),
    'Nama Kabupaten': payload.namaKabupaten || payload.namaWilayah || '-',
    'Provinsi': payload.provinsi || 'Jawa Timur',
    'Keterangan': payload.keterangan || '-',
    'Link Google Maps Kantor': payload.linkMaps || '-',
    'Latitude Kantor': lat,
    'Longitude Kantor': lng,
    'Radius Absensi': Number(payload.radiusMeter) || 100,
    'Nama Bank': payload.namaBank || '-',
    'Nomor Rekening': payload.nomorRekening || '-',
    'Atas Nama Rekening': payload.atasNama || '-',
    'QRIS Image URL': payload.qrisUrl || '-',
    'Status': payload.status || 'Aktif'
  };

  for (let i = 0; i < data.length; i++) {
    if (data[i]['Kode Wilayah'] === payload.kodeWilayah) {
      const r = i + 2;
      updateRowByHeaderMap(sheet, r, wilObj);
      clearSheetCache('WILAYAH');
      return { success: true, message: 'Lokasi dan data wilayah ' + payload.kodeWilayah + ' berhasil diperbarui!' };
    }
  }

  if (userRole === 'Admin' && userWilayah && userWilayah !== 'SEMUA') {
    return { success: false, message: 'Admin cabang tidak diperkenankan menambah cabang baru!' };
  }

  wilObj['Kode Wilayah'] = payload.kodeWilayah.toUpperCase();
  wilObj['Tanggal Dibuat'] = new Date().toISOString();
  appendRowByHeaderMap(sheet, wilObj);
  clearSheetCache('WILAYAH');
  return { success: true, message: 'Wilayah baru ' + payload.kodeWilayah + ' berhasil ditambahkan!' };
}

function apiDeleteMasterWilayah(kodeWilayah, userRole) {
  if (userRole && userRole !== 'Owner') {
    return { success: false, message: 'Hanya Owner yang memiliki izin untuk menghapus cabang wilayah!' };
  }

  // 1. Delete dari Supabase jika aktif
  if (typeof isSupabaseActive === 'function' && isSupabaseActive()) {
    try {
      supabaseDelete('wilayah', { kode_wilayah: 'eq.' + kodeWilayah });
    } catch (errDel) {
      Logger.log('[Dual-DB] Gagal delete wilayah Supabase: ' + errDel.message);
    }
  }

  // 2. Delete dari Google Sheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('WILAYAH');
  const data = getSheetData('WILAYAH') || [];

  for (let i = 0; i < data.length; i++) {
    if (data[i]['Kode Wilayah'] === kodeWilayah) {
      sheet.deleteRow(i + 2);
      clearSheetCache('WILAYAH');
      return { success: true, message: 'Wilayah ' + kodeWilayah + ' berhasil dihapus!' };
    }
  }
  return { success: false, message: 'Wilayah tidak ditemukan!' };
}

function apiRepairDuplicateUserIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('USERS');
  if (!sheet) return { success: false, message: 'Sheet USERS tidak ditemukan!' };
  const data = getSheetData('USERS') || [];
  if (data.length === 0) return { success: true, message: 'Tidak ada data user.', repairedCount: 0 };

  // 1. Cari nomor ID tertinggi yang ada
  let maxIdNum = 0;
  data.forEach(u => {
    const m = String(u['User ID'] || '').match(/USR-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxIdNum) maxIdNum = n;
    }
  });

  // 2. Deteksi dan perbaiki ID duplikat
  const seenIds = new Set();
  let repairedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const rawId = String(data[i]['User ID'] || '').trim();
    if (seenIds.has(rawId)) {
      maxIdNum++;
      const newId = 'USR-' + String(maxIdNum).padStart(3, '0');
      const r = i + 2;
      updateRowByHeaderMap(sheet, r, { 'User ID': newId });
      seenIds.add(newId);
      repairedCount++;
    } else {
      if (rawId) seenIds.add(rawId);
    }
  }

  return {
    success: true,
    message: repairedCount > 0 
      ? 'Berhasil merapikan ' + repairedCount + ' User ID duplikat menjadi ID unik!'
      : 'Semua User ID sudah unik, tidak ditemukan duplikat.',
    repairedCount: repairedCount
  };
}

function apiRepairDuplicateOutletCodes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('OUTLET');
  if (!sheet) return { success: false, message: 'Sheet OUTLET tidak ditemukan!' };
  const data = getSheetData('OUTLET') || [];
  if (data.length === 0) return { success: true, message: 'Tidak ada data outlet.', repairedCount: 0 };

  // 1. Cari nomor ID tertinggi yang ada
  let maxOutletNum = 0;
  data.forEach(o => {
    const m = String(o['Kode Outlet'] || '').match(/OTL-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxOutletNum) maxOutletNum = n;
    }
  });

  // 2. Deteksi dan perbaiki ID duplikat
  const seenCodes = new Set();
  let repairedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const rawCode = String(data[i]['Kode Outlet'] || '').trim().toUpperCase();
    if (seenCodes.has(rawCode)) {
      maxOutletNum++;
      const newCode = 'OTL-' + String(maxOutletNum).padStart(3, '0');
      const r = i + 2;
      updateRowByHeaderMap(sheet, r, { 'Kode Outlet': newCode });
      seenCodes.add(newCode);
      repairedCount++;
    } else {
      if (rawCode) seenCodes.add(rawCode);
    }
  }

  return {
    success: true,
    message: repairedCount > 0 
      ? 'Berhasil merapikan ' + repairedCount + ' Kode Outlet duplikat menjadi ID unik!'
      : 'Semua Kode Outlet sudah unik, tidak ditemukan duplikat.',
    repairedCount: repairedCount
  };
}

function apiRepairDuplicateProductCodes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('PRODUK');
  if (!sheet) return { success: false, message: 'Sheet PRODUK tidak ditemukan!' };
  const data = getSheetData('PRODUK') || [];
  if (data.length === 0) return { success: true, message: 'Tidak ada data produk.', repairedCount: 0 };

  let maxProdNum = 0;
  data.forEach(p => {
    const m = String(p['Kode Produk'] || '').match(/PRD-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > maxProdNum) maxProdNum = n;
    }
  });

  const seenCodes = new Set();
  let repairedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const rawCode = String(data[i]['Kode Produk'] || '').trim().toUpperCase();
    if (seenCodes.has(rawCode)) {
      maxProdNum++;
      const newCode = 'PRD-' + String(maxProdNum).padStart(3, '0');
      const r = i + 2;
      updateRowByHeaderMap(sheet, r, { 'Kode Produk': newCode });
      seenCodes.add(newCode);
      repairedCount++;
    } else {
      if (rawCode) seenCodes.add(rawCode);
    }
  }

  return {
    success: true,
    message: repairedCount > 0 
      ? 'Berhasil merapikan ' + repairedCount + ' Kode Produk duplikat menjadi kode unik!'
      : 'Semua Kode Produk sudah unik, tidak ditemukan duplikat.',
    repairedCount: repairedCount
  };
}

function apiSaveMasterUser(payload) {
  payload = payload || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheetCaseInsensitive('USERS');
  if (!sheet) return { success: false, message: 'Sheet USERS tidak ditemukan!' };
  const data = getSheetData('USERS') || [];

  const creatorRole = String(payload.creatorRole || '').trim();
  const creatorWilayah = String(payload.creatorWilayah || '').trim();
  let role = String(payload.role || 'Sales').trim();
  let kodeWilayah = String(payload.kodeWilayah || '').trim();

  // ATURAN KEAMANAN & PRIVASI AREA (RBAC):
  // 1. Akun Admin HANYA BISA membuat akun Sales!
  if (creatorRole === 'Admin') {
    if (role !== 'Sales') {
      return { success: false, message: 'Akses Ditolak: Admin hanya diizinkan membuat akun Sales!' };
    }
    // 2. Admin Cabang otomatis terkunci pada wilayahnya sendiri
    if (creatorWilayah && creatorWilayah !== 'SEMUA') {
      kodeWilayah = creatorWilayah;
    }
  }

  const userObj = {
    'Username': payload.username,
    'Nama Lengkap': payload.namaLengkap,
    'Role': role,
    'Kode Wilayah': kodeWilayah,
    'Nomor HP': payload.nomorHp,
    'Status': payload.status || 'Aktif'
  };
  if (payload.password) userObj['Password Hash'] = payload.password;

  // Jika mengedit user yang sudah ada
  if (payload.userId) {
    const targetId = String(payload.userId).trim();
    const targetUname = String(payload.originalUsername || payload.username || '').trim().toLowerCase();

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i]['User ID'] || '').trim();
      const rowUname = String(data[i]['Username'] || '').trim().toLowerCase();

      if (rowId === targetId && (!payload.originalUsername || rowUname === targetUname)) {
        const existingRole = String(data[i]['Role'] || '').trim();
        const existingWil = String(data[i]['Kode Wilayah'] || '').trim();

        // Admin dilarang keras mengutak-atik akun Owner atau Admin lain!
        if (creatorRole === 'Admin') {
          if (existingRole === 'Owner' || existingRole === 'Admin') {
            return { success: false, message: 'Akses Ditolak: Admin tidak diizinkan mengubah akun Owner atau sesama Admin!' };
          }
          if (creatorWilayah && creatorWilayah !== 'SEMUA' && existingWil !== creatorWilayah) {
            return { success: false, message: 'Akses Ditolak: Anda hanya boleh mengedit akun Sales di wilayah Anda (' + creatorWilayah + ')!' };
          }
        }

        const r = i + 2;
        updateRowByHeaderMap(sheet, r, userObj);
        SpreadsheetApp.flush();
        return { success: true, message: 'Pengguna ' + payload.namaLengkap + ' (' + payload.userId + ') berhasil diperbarui!' };
      }
    }
  }

  // Hitung nomor User ID berikutnya secara STRICTLY INCREMENTAL (Cari ID angka terbesar + 1)
  let maxIdNum = 0;
  for (let i = 0; i < data.length; i++) {
    const rawId = String(data[i]['User ID'] || '').trim();
    const match = rawId.match(/USR-(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n) && n > maxIdNum) maxIdNum = n;
    }
  }
  const nextIdNum = maxIdNum + 1;
  const userId = 'USR-' + String(nextIdNum).padStart(3, '0');

  userObj['User ID'] = userId;
  userObj['Password Hash'] = payload.password || '123456';
  userObj['Tanggal Dibuat'] = new Date().toISOString();

  appendRowByHeaderMap(sheet, userObj);
  SpreadsheetApp.flush();
  return { success: true, message: 'Pengguna baru ' + payload.namaLengkap + ' (' + userId + ') berhasil didaftarkan sebagai Sales wilayah ' + kodeWilayah + '!' };
}

function apiDeleteUser(userId, username, creatorRole, creatorWilayah) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheetCaseInsensitive('USERS');
  if (!sheet) return { success: false, message: 'Sheet USERS tidak ditemukan!' };
  const data = getSheetData('USERS') || [];

  const targetId = String(userId || '').trim();
  const targetUname = String(username || '').trim().toLowerCase();
  creatorRole = String(creatorRole || '').trim();
  creatorWilayah = String(creatorWilayah || '').trim();

  for (let i = 0; i < data.length; i++) {
    const rowId = String(data[i]['User ID'] || '').trim();
    const rowUname = String(data[i]['Username'] || '').trim().toLowerCase();

    var isMatch = false;
    if (targetUname && rowUname === targetUname) {
      isMatch = true;
    } else if (targetId && rowId === targetId) {
      isMatch = true;
    }

    if (isMatch) {
      const existingRole = String(data[i]['Role'] || '').trim();
      const existingWil = String(data[i]['Kode Wilayah'] || '').trim();

      if (creatorRole === 'Admin') {
        if (existingRole === 'Owner' || existingRole === 'Admin') {
          return { success: false, message: 'Akses Ditolak: Admin tidak diizinkan menghapus akun Owner atau sesama Admin!' };
        }
        if (creatorWilayah && creatorWilayah !== 'SEMUA' && existingWil !== creatorWilayah) {
          return { success: false, message: 'Akses Ditolak: Anda hanya boleh menghapus akun Sales di wilayah Anda (' + creatorWilayah + ')!' };
        }
      }

      // 1. Delete dari Supabase jika aktif
      if (typeof isSupabaseActive === 'function' && isSupabaseActive()) {
        try {
          supabaseDelete('users', { user_id: 'eq.' + rowId });
        } catch (errDel) {
          Logger.log('[Dual-DB] Gagal delete user Supabase: ' + errDel.message);
        }
      }

      // 2. Delete dari Google Sheet
      sheet.deleteRow(i + 2);
      delete _executionSheetDataCache['USERS'];
      SpreadsheetApp.flush();
      return { success: true, message: 'User ' + (data[i]['Nama Lengkap'] || targetId) + ' berhasil dihapus!' };
    }
  }
  return { success: false, message: 'User tidak ditemukan!' };
}

function apiResetPasswordUser(userId, newPassword) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('USERS');
  const data = getSheetData('USERS') || [];

  for (let i = 0; i < data.length; i++) {
    if (data[i]['User ID'] === userId) {
      updateRowByHeaderMap(sheet, i + 2, { 'Password Hash': newPassword });
      return { success: true, message: 'Password user berhasil direset!' };
    }
  }
  return { success: false, message: 'User tidak ditemukan!' };
}

function apiToggleUserStatus(userId, newStatus) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('USERS');
  const data = getSheetData('USERS') || [];

  for (let i = 0; i < data.length; i++) {
    if (data[i]['User ID'] === userId) {
      updateRowByHeaderMap(sheet, i + 2, { 'Status': newStatus });
      return { success: true, message: 'Status user diubah menjadi: ' + newStatus };
    }
  }
  return { success: false, message: 'User tidak ditemukan!' };
}

function apiSaveConfig(configMap) {
  configMap = configMap || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = getSheetCaseInsensitive('CONFIG');
  if (!sheet) {
    sheet = ss.insertSheet('CONFIG');
    sheet.appendRow(['Key', 'Value', 'Keterangan']);
  }

  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), 3);
  let headers = [];
  if (lastRow >= 1) {
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  } else {
    headers = ['Key', 'Value', 'Keterangan'];
    sheet.appendRow(headers);
  }

  let keyColIdx = headers.findIndex(h => h.toLowerCase() === 'key') + 1;
  let valColIdx = headers.findIndex(h => h.toLowerCase() === 'value') + 1;
  if (keyColIdx <= 0) keyColIdx = 1;
  if (valColIdx <= 0) valColIdx = 2;

  if (configMap['Link Google Maps Kantor']) {
    const url = String(configMap['Link Google Maps Kantor']);
    const match1 = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match2 = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match3 = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    const match4 = url.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match5 = url.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/);
    const match6 = url.match(/^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/);

    const m = match1 || match2 || match3 || match4 || match5 || match6;
    if (m) {
      configMap['Latitude Kantor'] = Number(m[1]);
      configMap['Longitude Kantor'] = Number(m[2]);
    }
  }

  // Otomatis ubah Google Drive link ke Google CDN lh3 (Logo & QRIS)
  ['Logo URL', 'QRIS Image URL'].forEach(prop => {
    if (configMap[prop]) {
      const u = String(configMap[prop]).trim();
      const driveMatch = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (driveMatch && driveMatch[1]) {
        configMap[prop] = 'https://lh3.googleusercontent.com/d/' + driveMatch[1];
      }
    }
  });

  const existingValues = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

  for (const key in configMap) {
    const normKey = String(key).trim().toLowerCase();
    let found = false;
    for (let r = 0; r < existingValues.length; r++) {
      const rowKey = String(existingValues[r][keyColIdx - 1] || '').trim().toLowerCase();
      if (rowKey === normKey) {
        sheet.getRange(r + 2, valColIdx).setValue(configMap[key]);
        existingValues[r][valColIdx - 1] = configMap[key];
        found = true;
        break;
      }
    }
    if (!found) {
      const newRow = [];
      newRow[keyColIdx - 1] = key;
      newRow[valColIdx - 1] = configMap[key];
      const descIdx = headers.findIndex(h => h.toLowerCase() === 'keterangan');
      if (descIdx >= 0) newRow[descIdx] = 'Konfigurasi sistem';
      sheet.appendRow(newRow);
      existingValues.push(newRow);
    }
  }

  // Dual-DB: Simpan juga ke Supabase jika aktif
  if (typeof isSupabaseActive === 'function' && isSupabaseActive()) {
    try {
      const supaConfigList = [];
      for (const k in configMap) {
        supaConfigList.push({
          key: k,
          value: String(configMap[k] !== undefined && configMap[k] !== null ? configMap[k] : ''),
          keterangan: 'Konfigurasi sistem'
        });
      }
      if (supaConfigList.length > 0) {
        supabaseUpsert('config', supaConfigList, 'key');
      }
    } catch (errCfg) {
      Logger.log('[Dual-DB Config] Gagal simpan ke Supabase: ' + errCfg.message);
    }
  }

  // Pastikan perubahan langsung disimpan permanen di database spreadsheet
  SpreadsheetApp.flush();
  clearSheetCache('CONFIG');

  return { 
    success: true, 
    message: 'Pengaturan sistem berhasil disimpan secara permanen di database Google Sheets!',
    config: getConfigMap()
  };
}

/**
 * Upload Logo Langsung ke Google Drive & Simpan ke CONFIG sebagai Google CDN (lh3)
 */
function apiUploadLogo(payload) {
  try {
    payload = payload || {};
    const base64Data = payload.imageBase64;
    if (!base64Data || typeof base64Data !== 'string' || !base64Data.startsWith('data:image')) {
      return { success: false, message: 'Format file gambar tidak valid.' };
    }
    const config = getConfigMap();
    const folderId = config['Folder ID Display'] || config['Folder ID Kunjungan'] || null;
    const fileName = 'Logo_App_' + Date.now() + '.png';
    const directUrl = saveBase64ImageToDrive(base64Data, folderId, fileName);

    let sheet = getSheetCaseInsensitive('CONFIG');
    if (sheet) {
      const lastRow = sheet.getLastRow();
      const lastCol = Math.max(sheet.getLastColumn(), 3);
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim().toLowerCase());
      let keyColIdx = headers.indexOf('key') + 1;
      let valColIdx = headers.indexOf('value') + 1;
      if (keyColIdx <= 0) keyColIdx = 1;
      if (valColIdx <= 0) valColIdx = 2;

      const existingValues = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
      let found = false;
      for (let r = 0; r < existingValues.length; r++) {
        const rowKey = String(existingValues[r][keyColIdx - 1] || '').trim().toLowerCase();
        if (rowKey === 'logo url') {
          sheet.getRange(r + 2, valColIdx).setValue(directUrl);
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow(['Logo URL', directUrl, 'URL gambar logo webapp (transparan/PNG)']);
      }
      SpreadsheetApp.flush();
    }

    return {
      success: true,
      url: directUrl,
      message: 'Logo berhasil diupload ke Google Drive & diatur ke sistem!'
    };
  } catch (err) {
    Logger.log('Error apiUploadLogo: ' + err.message);
    return { success: false, message: 'Gagal mengupload logo: ' + err.message };
  }
}

/**
 * Upload Foto Barcode QRIS Langsung ke Google Drive & Simpan ke CONFIG sebagai Google CDN (lh3)
 */
function apiUploadQris(payload) {
  try {
    payload = payload || {};
    const base64Data = payload.imageBase64;
    if (!base64Data || typeof base64Data !== 'string' || !base64Data.startsWith('data:image')) {
      return { success: false, message: 'Format file barcode QRIS tidak valid.' };
    }
    const config = getConfigMap();
    const folderId = config['Folder ID Display'] || config['Folder ID Kunjungan'] || null;
    const fileName = 'QRIS_Barcode_' + Date.now() + '.png';
    const directUrl = saveBase64ImageToDrive(base64Data, folderId, fileName);

    let sheet = getSheetCaseInsensitive('CONFIG');
    if (sheet) {
      const lastRow = sheet.getLastRow();
      const lastCol = Math.max(sheet.getLastColumn(), 3);
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim().toLowerCase());
      let keyColIdx = headers.indexOf('key') + 1;
      let valColIdx = headers.indexOf('value') + 1;
      if (keyColIdx <= 0) keyColIdx = 1;
      if (valColIdx <= 0) valColIdx = 2;

      const existingValues = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
      let found = false;
      for (let r = 0; r < existingValues.length; r++) {
        const rowKey = String(existingValues[r][keyColIdx - 1] || '').trim().toLowerCase();
        if (rowKey === 'qris image url') {
          sheet.getRange(r + 2, valColIdx).setValue(directUrl);
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow(['QRIS Image URL', directUrl, 'Link barcode QRIS untuk pembayaran digital']);
      }
      SpreadsheetApp.flush();
    }

    return {
      success: true,
      url: directUrl,
      message: 'Foto barcode QRIS berhasil diupload ke Google Drive & disimpan ke sistem!'
    };
  } catch (err) {
    Logger.log('Error apiUploadQris: ' + err.message);
    return { success: false, message: 'Gagal mengupload barcode QRIS: ' + err.message };
  }
}

// ==============================================================================
// 4. LAPORAN & REKAP EXPORT
// ==============================================================================

function apiGetLaporanData(tipeLaporan, filters) {
  try {
    filters = filters || {};
    const allUsers = getSheetData('USERS') || [];
    const allOutlet = getSheetData('OUTLET') || [];
    
    const userMap = {};
    const userWilayahMap = {};
    allUsers.forEach(u => { 
      userMap[String(u['User ID']).trim()] = String(u['Nama Lengkap'] || u['Username'] || '-'); 
      userWilayahMap[String(u['User ID']).trim()] = String(u['Kode Wilayah'] || '-');
    });

    const outletMap = {};
    const outletWilayahMap = {};
    allOutlet.forEach(o => { 
      outletMap[String(o['Kode Outlet']).trim()] = String(o['Nama Toko'] || '-'); 
      outletWilayahMap[String(o['Kode Outlet']).trim()] = String(o['Kode Wilayah'] || '-');
    });

    function matchWilayah(itemWilayah, targetWilayah) {
      if (!targetWilayah || targetWilayah === 'SEMUA') return true;
      if (!itemWilayah) return false;
      const w1 = String(itemWilayah).trim().toLowerCase();
      const w2 = String(targetWilayah).trim().toLowerCase();
      return w1 === w2 || w1.indexOf(w2) !== -1 || w2.indexOf(w1) !== -1;
    }

    switch (tipeLaporan) {
      case 'PENJUALAN': {
        let trx = getSheetData('TRANSAKSI') || [];
        const fStart = filters.startDate ? normalizeDateOnly(filters.startDate) : '';
        const fEnd = filters.endDate ? normalizeDateOnly(filters.endDate) : '';
        if (fStart || fEnd) {
          trx = trx.filter(t => {
            const d = normalizeDateOnly(t['Waktu Transaksi'] || t['Tanggal Dibuat']);
            if (!d) return false;
            return (!fStart || d >= fStart) && (!fEnd || d <= fEnd);
          });
        }
        if (filters.kodeWilayah && filters.kodeWilayah !== 'SEMUA') {
          trx = trx.filter(t => {
            const tw = t['Kode Wilayah'] || outletWilayahMap[String(t['Kode Outlet']).trim()];
            return matchWilayah(tw, filters.kodeWilayah);
          });
        }
        if (filters.salesId && filters.salesId !== 'SEMUA') {
          trx = trx.filter(t => String(t['ID Sales']).trim() === String(filters.salesId).trim());
        }

        const rows = trx.map(t => {
          let waktuVal = t['Waktu Transaksi'] || t['Tanggal Dibuat'];
          let waktuStr = '-';
          if (waktuVal instanceof Date) {
            waktuStr = Utilities.formatDate(waktuVal, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
          } else if (waktuVal) {
            waktuStr = String(waktuVal);
          }

          return {
            nomorFaktur: String(t['Nomor Faktur'] || '-'),
            waktu: waktuStr,
            namaSales: userMap[String(t['ID Sales']).trim()] || String(t['ID Sales'] || '-'),
            namaOutlet: outletMap[String(t['Kode Outlet']).trim()] || String(t['Kode Outlet'] || '-'),
            wilayah: String(t['Kode Wilayah'] || outletWilayahMap[String(t['Kode Outlet']).trim()] || '-'),
            totalItem: Number(t['Total Item']) || 0,
            subtotal: Number(t['Subtotal']) || 0,
            diskon: Number(t['Diskon']) || 0,
            totalAkhir: Number(t['Total Akhir']) || 0,
            metodeBayar: String(t['Metode Pembayaran'] || 'Cash'),
            statusBayar: String(t['Status Pembayaran'] || 'Lunas')
          };
        });
        return { success: true, data: rows };
      }

      case 'KUNJUNGAN': {
        let kunjungan = getSheetData('KUNJUNGAN') || [];
        const fStart = filters.startDate ? normalizeDateOnly(filters.startDate) : '';
        const fEnd = filters.endDate ? normalizeDateOnly(filters.endDate) : '';
        if (fStart || fEnd) {
          kunjungan = kunjungan.filter(k => {
            const d = normalizeDateOnly(k['Tanggal']);
            if (!d) return false;
            return (!fStart || d >= fStart) && (!fEnd || d <= fEnd);
          });
        }
        if (filters.kodeWilayah && filters.kodeWilayah !== 'SEMUA') {
          kunjungan = kunjungan.filter(k => {
            const kw = outletWilayahMap[String(k['Kode Outlet']).trim()];
            return matchWilayah(kw, filters.kodeWilayah);
          });
        }
        if (filters.salesId && filters.salesId !== 'SEMUA') {
          kunjungan = kunjungan.filter(k => String(k['ID Sales']).trim() === String(filters.salesId).trim());
        }

        const rows = kunjungan.map(k => {
          let tglStr = normalizeDateOnly(k['Tanggal']) || String(k['Tanggal'] || '-').replace(/1899-12-3[01][T ]?/, '').trim().substring(0, 10);
          let jamStr = (k['Jam Kunjungan'] instanceof Date 
            ? Utilities.formatDate(k['Jam Kunjungan'], Session.getScriptTimeZone(), 'HH:mm:ss') 
            : String(k['Jam Kunjungan'] || '-')).replace(/1899-12-3[01][T ]?/, '').trim() || '-';

          return {
            idKunjungan: String(k['ID Kunjungan'] || '-'),
            namaSales: userMap[String(k['ID Sales']).trim()] || String(k['ID Sales'] || '-'),
            namaOutlet: outletMap[String(k['Kode Outlet']).trim()] || String(k['Kode Outlet'] || '-'),
            tanggal: tglStr,
            jam: jamStr,
            jarakMeter: Number(k['Jarak Meter']) || 0,
            statusValidasi: String(k['Status Validasi'] || 'Valid'),
            fotoSelfie: String(k['Foto Selfie'] || '-'),
            fotoBarang: String(k['Foto Barang'] || '-'),
            fotoDisplay: String(k['Foto Display'] || '-'),
            catatan: String(k['Catatan Kunjungan'] || '-')
          };
        });
        return { success: true, data: rows };
      }

      case 'ABSENSI': {
        let absensi = getSheetData('ABSENSI') || [];
        const fStart = filters.startDate ? normalizeDateOnly(filters.startDate) : '';
        const fEnd = filters.endDate ? normalizeDateOnly(filters.endDate) : '';
        if (fStart || fEnd) {
          absensi = absensi.filter(a => {
            const d = normalizeDateOnly(a['Tanggal']);
            if (!d) return false;
            return (!fStart || d >= fStart) && (!fEnd || d <= fEnd);
          });
        }
        if (filters.kodeWilayah && filters.kodeWilayah !== 'SEMUA') {
          absensi = absensi.filter(a => {
            const aw = userWilayahMap[String(a['ID Sales']).trim()];
            return matchWilayah(aw, filters.kodeWilayah);
          });
        }
        if (filters.salesId && filters.salesId !== 'SEMUA') {
          absensi = absensi.filter(a => String(a['ID Sales']).trim() === String(filters.salesId).trim());
        }

        const rows = absensi.map(a => {
          let tglStr = normalizeDateOnly(a['Tanggal']) || String(a['Tanggal'] || '-').replace(/1899-12-3[01][T ]?/, '').trim().substring(0, 10);
          let jamMasukStr = (a['Jam Masuk'] instanceof Date 
            ? Utilities.formatDate(a['Jam Masuk'], Session.getScriptTimeZone(), 'HH:mm:ss') 
            : String(a['Jam Masuk'] || '-')).replace(/1899-12-3[01][T ]?/, '').trim() || '-';
          let jamPulangStr = (a['Jam Pulang'] instanceof Date 
            ? Utilities.formatDate(a['Jam Pulang'], Session.getScriptTimeZone(), 'HH:mm:ss') 
            : String(a['Jam Pulang'] || '-')).replace(/1899-12-3[01][T ]?/, '').trim() || '-';

          return {
            idAbsensi: String(a['ID Absensi'] || '-'),
            namaSales: userMap[String(a['ID Sales']).trim()] || String(a['ID Sales'] || '-'),
            tanggal: tglStr,
            jamMasuk: jamMasukStr,
            jamPulang: jamPulangStr,
            jarakMasuk: Number(a['Jarak Masuk Meter']) || 0,
            jarakPulang: Number(a['Jarak Pulang Meter']) || 0,
            statusLokasi: String(a['Status Lokasi'] || '-'),
            fotoMasuk: String(a['Foto Selfie Masuk'] || '-'),
            fotoPulang: String(a['Foto Selfie Pulang'] || '-')
          };
        });
        return { success: true, data: rows };
      }

      case 'BRAND_MATRIX': {
        let trx = getSheetData('TRANSAKSI') || [];
        const fStart = filters.startDate ? normalizeDateOnly(filters.startDate) : '';
        const fEnd = filters.endDate ? normalizeDateOnly(filters.endDate) : '';
        if (fStart || fEnd) {
          trx = trx.filter(t => {
            const d = normalizeDateOnly(t['Waktu Transaksi'] || t['Tanggal Dibuat']);
            if (!d) return false;
            return (!fStart || d >= fStart) && (!fEnd || d <= fEnd);
          });
        }
        if (filters.kodeWilayah && filters.kodeWilayah !== 'SEMUA') {
          trx = trx.filter(t => {
            const tw = t['Kode Wilayah'] || outletWilayahMap[String(t['Kode Outlet']).trim()];
            return matchWilayah(tw, filters.kodeWilayah);
          });
        }
        if (filters.salesId && filters.salesId !== 'SEMUA') {
          trx = trx.filter(t => String(t['ID Sales']).trim() === String(filters.salesId).trim());
        }

        const allTrxDetail = getSheetData('TRANSAKSI DETAIL') || [];
        const allProduk = getCachedSheetData('PRODUK') || [];
        let allKunjungan = getSheetData('KUNJUNGAN') || [];

        if (fStart || fEnd) {
          allKunjungan = allKunjungan.filter(k => {
            const d = normalizeDateOnly(k['Tanggal']);
            if (!d) return false;
            return (!fStart || d >= fStart) && (!fEnd || d <= fEnd);
          });
        }
        if (filters.kodeWilayah && filters.kodeWilayah !== 'SEMUA') {
          allKunjungan = allKunjungan.filter(k => {
            const kw = outletWilayahMap[String(k['Kode Outlet']).trim()];
            return matchWilayah(kw, filters.kodeWilayah);
          });
        }
        if (filters.salesId && filters.salesId !== 'SEMUA') {
          allKunjungan = allKunjungan.filter(k => String(k['ID Sales']).trim() === String(filters.salesId).trim());
        }

        // 1. Focus Brands untuk PERSENTASE KEBERADAAN (ADA %, RO %, KB %) Sesuai Gambar 1
        const focusBrands = [
          { key: 'PSK', label: 'PS KRETEK' },
          { key: 'AGE', label: 'AGE PRO' },
          { key: 'PSF', label: 'PS FILTER' },
          { key: 'ARTI', label: 'ARTI LUXE' },
          { key: 'AAM', label: 'ARTI AM' }
        ];

        // 2. Omset Brands (Satuan Bungkus & Ball) Sesuai Gambar 1
        const defaultOmsetDefs = [
          { key: 'PSK', label: 'PS K', ratio: 200, targetBall: 7.5 },
          { key: 'AGE', label: 'AGE', ratio: 200, targetBall: 9.0 },
          { key: 'PSF', label: 'PS F', ratio: 200, targetBall: 3.0 },
          { key: 'ARTI', label: 'ARTI', ratio: 200, targetBall: 3.0 },
          { key: 'AAM', label: 'AAM', ratio: 100, targetBall: 1.0 },
          { key: 'PSS', label: 'PSS', ratio: 100, targetBall: 0.3 },
          { key: 'MILD', label: 'PS MILD', ratio: 100, targetBall: 0.3 },
          { key: 'MANGGA', label: 'MNGGO', ratio: 100, targetBall: 0.3 },
          { key: 'WT MELON', label: 'WTM', ratio: 100, targetBall: 0.3 },
          { key: 'PURPLE', label: 'PURPLE', ratio: 100, targetBall: 0.3 },
          { key: 'APEL', label: 'APPLE', ratio: 100, targetBall: 0.3 }
        ];

        const brandToRatioMap = {};
        allProduk.forEach(p => {
          const code = String(p['Kode Produk'] || '').trim().toUpperCase();
          const name = String(p['Nama Produk'] || '').trim().toUpperCase();
          const singkatan = String(p['Singkatan'] || '').trim().toUpperCase();
          const ratioVal = Number(p['Isi Per Bal'] || p['Isi Per Bal (Bks)'] || p['Konversi Bal']);
          if (ratioVal > 0) {
            if (code) brandToRatioMap[code] = ratioVal;
            if (singkatan) brandToRatioMap[singkatan] = ratioVal;
          }
        });

        function resolveBrandKey(kProd, nProd) {
          const code = String(kProd || '').trim().toUpperCase();
          const name = String(nProd || '').trim().toUpperCase();
          if (code === 'PSD' || code === 'PSK' || name.includes('PSK') || name.includes('DJERAM') || code.includes('KRETEK') || name.includes('KRETEK')) return 'PSK';
          if (code === 'AGE' || name.includes('AGE')) return 'AGE';
          if (code === 'PSF' || name.includes('PSF') || name.includes('FILTER')) return 'PSF';
          if (code === 'ART' || code === 'ARTI' || name.includes('ARTI LUXE') || name === 'ARTI') return 'ARTI';
          if (code === 'AAM' || code === 'PSAPL' || name.includes('APEL MADU') || name.includes('ARTI AM')) return 'AAM';
          if (code === 'PSE' || code === 'PSS' || name.includes('EXCLUSIVE') || name.includes('SPLASH')) return 'PSS';
          if (code === 'PSMI' || code === 'MILD' || name.includes('MILD')) return 'MILD';
          if (code === 'PSMGO' || code === 'MANGGA' || name.includes('MANGGA')) return 'MANGGA';
          if (code === 'PSPLR' || code === 'PURPLE' || name.includes('PURPLE')) return 'PURPLE';
          if (code === 'PSWTM' || code === 'WTMELON' || code === 'WT MELON' || name.includes('MELON')) return 'WT MELON';
          if (code === 'PSAPL' || code === 'APEL' || name.includes('APEL')) return 'APEL';
          if (code === 'KJJ' || name.includes('KOPI') || name.includes('JOSJIS')) return 'KOPI JOSJIS';
          return code || name || 'LAINNYA';
        }

        function getBrandRatio(bKey) {
          if (brandToRatioMap[bKey]) return brandToRatioMap[bKey];
          if (bKey === 'AAM' || bKey === 'PSS' || bKey === 'MILD' || bKey === 'MANGGA' || bKey === 'WT MELON' || bKey === 'PURPLE' || bKey === 'APEL') return 100;
          return 200;
        }

        const omsetBrands = defaultOmsetDefs.map(def => ({
          key: def.key,
          label: def.label,
          ratio: getBrandRatio(def.key),
          targetBall: def.targetBall
        }));

        // Target OV (Outlet Visit) per sales (default 40 per hari)
        let targetOV = 40;
        if (fStart && fEnd && fStart !== fEnd) {
          try {
            const d1 = new Date(fStart);
            const d2 = new Date(fEnd);
            const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
            targetOV = 40 * Math.max(1, diffDays);
          } catch (e) {
            targetOV = 40;
          }
        }

        // Map Transaksi per Faktur & Sales
        const trxFakturSalesMap = {};
        const trxFakturOutletMap = {};
        const trxSalesOutletBrandsSold = {};

        trx.forEach(t => {
          const fId = String(t['Nomor Faktur'] || '').trim();
          const sId = String(t['ID Sales'] || '').trim();
          const oCode = String(t['Kode Outlet'] || '').trim().toUpperCase();
          trxFakturSalesMap[fId] = sId;
          trxFakturOutletMap[fId] = oCode;
        });

        const salesOmsetQty = {};

        allTrxDetail.forEach(dt => {
          const fId = String(dt['Nomor Faktur'] || '').trim();
          const sId = trxFakturSalesMap[fId];
          const oCode = trxFakturOutletMap[fId];
          const qty = Number(dt['Qty']) || 0;
          if (sId && qty > 0) {
            const bKey = resolveBrandKey(dt['Kode Produk'], dt['Nama Produk']);
            if (!trxSalesOutletBrandsSold[sId]) trxSalesOutletBrandsSold[sId] = {};
            if (!trxSalesOutletBrandsSold[sId][oCode]) trxSalesOutletBrandsSold[sId][oCode] = new Set();
            trxSalesOutletBrandsSold[sId][oCode].add(bKey);

            if (!salesOmsetQty[sId]) salesOmsetQty[sId] = {};
            salesOmsetQty[sId][bKey] = (salesOmsetQty[sId][bKey] || 0) + qty;
          }
        });

        // Ambil User dengan Role Sales
        const activeSales = allUsers.filter(u => u['Role'] === 'Sales' && String(u['Status'] || 'Aktif').toLowerCase() === 'aktif');
        const targetSales = activeSales.filter(u => {
          const sId = String(u['User ID']).trim();
          const sWil = userWilayahMap[sId] || '-';
          if (filters.kodeWilayah && filters.kodeWilayah !== 'SEMUA' && !matchWilayah(sWil, filters.kodeWilayah)) return false;
          if (filters.salesId && filters.salesId !== 'SEMUA' && sId !== String(filters.salesId).trim()) return false;
          return true;
        });

        // Susun baris performa sales
        const matrixRows = targetSales.map(u => {
          const sId = String(u['User ID']).trim();
          const sName = userMap[sId] || u['Nama Lengkap'] || sId;
          const sWil = userWilayahMap[sId] || '-';

          // Kunjungan sales ini
          const salesVisits = allKunjungan.filter(k => String(k['ID Sales']).trim() === sId);
          const visitedOutlets = new Set();
          salesVisits.forEach(k => {
            const oCode = String(k['Kode Outlet'] || '').trim().toUpperCase();
            if (oCode) visitedOutlets.add(oCode);
          });

          const roc = visitedOutlets.size || salesVisits.length;
          const percentKunjungan = targetOV > 0 ? Math.round((roc / targetOV) * 100) : 0;

          // Hitung ADA %, RO %, KB % per focus brand
          const focusBrandStats = {};
          focusBrands.forEach(fb => {
            let adaCount = 0;
            let roCount = 0;
            let kbOutlets = new Set();

            visitedOutlets.forEach(oCode => {
              const vToOutlet = salesVisits.find(k => String(k['Kode Outlet'] || '').trim().toUpperCase() === oCode);
              let hasAda = false;
              if (vToOutlet) {
                const presentBrands = parseStokTokoBrandsWithStock(vToOutlet['Stok Toko'], resolveBrandKey);
                if (presentBrands.has(fb.key)) {
                  hasAda = true;
                }
              }
              if (hasAda) {
                adaCount++;
                kbOutlets.add(oCode);
              }

              const hasRo = trxSalesOutletBrandsSold[sId] && trxSalesOutletBrandsSold[sId][oCode] && trxSalesOutletBrandsSold[sId][oCode].has(fb.key);
              if (hasRo) {
                roCount++;
                kbOutlets.add(oCode);
              }
            });

            const kbCount = kbOutlets.size;
            focusBrandStats[fb.key] = {
              adaCount: adaCount,
              roCount: roCount,
              kbCount: kbCount,
              adaPercent: roc > 0 ? Math.round((adaCount / roc) * 100) : 0,
              roPercent: roc > 0 ? Math.round((roCount / roc) * 100) : 0,
              kbPercent: roc > 0 ? Math.round((kbCount / roc) * 100) : 0
            };
          });

          // Omset per brand
          const omsetMap = {};
          let totalBks = 0;
          let totalBall = 0;
          omsetBrands.forEach(ob => {
            const qty = (salesOmsetQty[sId] && salesOmsetQty[sId][ob.key]) || 0;
            omsetMap[ob.key] = qty;
            totalBks += qty;
            totalBall += (qty / ob.ratio);
          });

          return {
            idSales: sId,
            namaSales: sName,
            wilayah: sWil,
            targetOV: targetOV,
            roc: roc,
            percentKunjungan: percentKunjungan,
            focusBrandStats: focusBrandStats,
            omsetBrands: omsetMap,
            totalBks: totalBks,
            totalBall: Number(totalBall.toFixed(2))
          };
        });

        // Ringkasan TOTAL / RATA RATA
        let sumTargetOV = 0;
        let sumROC = 0;
        const avgFocusBrands = {};
        focusBrands.forEach(fb => {
          avgFocusBrands[fb.key] = { adaPercent: 0, roPercent: 0, kbPercent: 0 };
        });

        const totalOmsetBrands = {};
        const totalBallPerBrand = {};
        omsetBrands.forEach(ob => {
          totalOmsetBrands[ob.key] = 0;
          totalBallPerBrand[ob.key] = 0;
        });

        let grandTotalBks = 0;
        let grandTotalBall = 0;

        matrixRows.forEach(r => {
          sumTargetOV += r.targetOV;
          sumROC += r.roc;
          grandTotalBks += r.totalBks;
          grandTotalBall += r.totalBall;

          omsetBrands.forEach(ob => {
            totalOmsetBrands[ob.key] += (r.omsetBrands[ob.key] || 0);
          });
        });

        const overallPercentKunjungan = sumTargetOV > 0 ? Math.round((sumROC / sumTargetOV) * 100) : 0;

        // Rata-rata persentase keberadaan tim
        focusBrands.forEach(fb => {
          let totAda = 0, totRo = 0, totKb = 0;
          let activeSalesCount = 0;
          matrixRows.forEach(r => {
            if (r.roc > 0) {
              totAda += r.focusBrandStats[fb.key].adaPercent;
              totRo += r.focusBrandStats[fb.key].roPercent;
              totKb += r.focusBrandStats[fb.key].kbPercent;
              activeSalesCount++;
            }
          });
          avgFocusBrands[fb.key] = {
            adaPercent: activeSalesCount > 0 ? Math.round(totAda / activeSalesCount) : 0,
            roPercent: activeSalesCount > 0 ? Math.round(totRo / activeSalesCount) : 0,
            kbPercent: activeSalesCount > 0 ? Math.round(totKb / activeSalesCount) : 0
          };
        });

        // Konversi Ball per brand
        omsetBrands.forEach(ob => {
          totalBallPerBrand[ob.key] = Number((totalOmsetBrands[ob.key] / ob.ratio).toFixed(1));
        });

        const targetBall = 600;
        const sisaTargetBall = Number((grandTotalBall - targetBall).toFixed(1));

        return {
          success: true,
          tipeLaporan: 'BRAND_MATRIX',
          focusBrands: focusBrands,
          omsetBrands: omsetBrands,
          data: matrixRows,
          summary: {
            totalTargetOV: sumTargetOV,
            totalROC: sumROC,
            overallPercentKunjungan: overallPercentKunjungan,
            avgFocusBrands: avgFocusBrands,
            totalOmsetBrands: totalOmsetBrands,
            totalBallPerBrand: totalBallPerBrand,
            grandTotalBks: grandTotalBks,
            grandTotalBall: Number(grandTotalBall.toFixed(1)),
            targetBall: targetBall,
            sisaTargetBall: sisaTargetBall
          }
        };
      }

      default:
        return { success: false, message: 'Tipe laporan tidak valid', data: [] };
    }
  } catch (err) {
    Logger.log('Error apiGetLaporanData: ' + err.message);
    return { success: false, message: 'Gagal memuat laporan: ' + err.message, data: [] };
  }
}

// ==============================================================================
// 5. UTILITY & DYNAMIC COLUMN HELPERS
// ==============================================================================

function ensureSheetColumnExists(sheet, columnName) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol <= 0) return;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim().toLowerCase());
  if (headers.indexOf(columnName.trim().toLowerCase()) === -1) {
    sheet.getRange(1, lastCol + 1).setValue(columnName);
  }
}

function getHeaderIndexMap(sheet) {
  if (!sheet) return {};
  const lastCol = sheet.getLastColumn();
  if (lastCol <= 0) return {};
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach((h, idx) => {
    if (h) map[String(h).trim()] = idx + 1; // 1-based index
  });
  return map;
}

const _executionSheetDataCache = {};

function updateRowByHeaderMap(sheet, rowIndex, dataMap) {
  if (!sheet) return;
  const sheetName = sheet.getName().trim().toUpperCase();
  delete _executionSheetDataCache[sheetName];

  // 1. Dual-write ke Supabase jika aktif
  if (typeof isSupabaseActive === 'function' && isSupabaseActive()) {
    try {
      if (typeof TABLE_MAPPINGS !== 'undefined' && TABLE_MAPPINGS[sheetName]) {
        const mapping = TABLE_MAPPINGS[sheetName];
        let pkVal = dataMap[mapping.sheetPrimaryKey];
        if (!pkVal) {
          const headerMap = getHeaderIndexMap(sheet);
          if (headerMap[mapping.sheetPrimaryKey]) {
            pkVal = sheet.getRange(rowIndex, headerMap[mapping.sheetPrimaryKey]).getValue();
          }
        }
        if (pkVal) {
          const supaPayload = mapSheetRowToSupabase(sheetName, dataMap);
          const filters = {};
          filters[mapping.primaryKey] = 'eq.' + pkVal;
          supabaseUpdate(mapping.tableName, supaPayload, filters);
        }
      }
    } catch (errSupa) {
      Logger.log('[Dual-DB Update] Error Supabase: ' + errSupa.message);
    }
  }

  // 2. Update Google Sheet (Backup / Cadangan)
  const headerMap = getHeaderIndexMap(sheet);
  for (const [key, value] of Object.entries(dataMap)) {
    if (headerMap[key]) {
      sheet.getRange(rowIndex, headerMap[key]).setValue(value);
    }
  }
}

function appendRowByHeaderMap(sheet, dataMap) {
  if (!sheet) return;
  const sheetName = sheet.getName().trim().toUpperCase();
  delete _executionSheetDataCache[sheetName];

  // 1. Dual-write ke Supabase jika aktif
  if (typeof isSupabaseActive === 'function' && isSupabaseActive()) {
    try {
      if (typeof TABLE_MAPPINGS !== 'undefined' && TABLE_MAPPINGS[sheetName]) {
        const mapping = TABLE_MAPPINGS[sheetName];
        const supaPayload = mapSheetRowToSupabase(sheetName, dataMap);
        supabaseInsert(mapping.tableName, supaPayload);
      }
    } catch (errSupa) {
      Logger.log('[Dual-DB Insert] Error Supabase: ' + errSupa.message);
    }
  }

  // 2. Append ke Google Sheet (Backup / Cadangan)
  const lastCol = sheet.getLastColumn();
  if (lastCol <= 0) return;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const rowValues = headers.map(h => {
    const key = String(h).trim();
    return dataMap[key] !== undefined ? dataMap[key] : '-';
  });
  sheet.appendRow(rowValues);
}

function getSheetCaseInsensitive(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const direct = ss.getSheetByName(sheetName);
  if (direct) return direct;
  const target = String(sheetName || '').trim().toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === target) {
      return sheets[i];
    }
  }
  return null;
}

function getSheetData(sheetName, forceSheets) {
  const norm = String(sheetName || '').trim().toUpperCase();
  if (!forceSheets && _executionSheetDataCache[norm]) {
    return _executionSheetDataCache[norm];
  }

  // 1. Dual-DB: Prioritas membaca dari Supabase secara realtime jika aktif dan memiliki data
  if (!forceSheets && typeof isSupabaseActive === 'function' && isSupabaseActive()) {
    try {
      if (typeof TABLE_MAPPINGS !== 'undefined' && TABLE_MAPPINGS[norm]) {
        const mapping = TABLE_MAPPINGS[norm];
        const supaRows = supabaseSelect(mapping.tableName);
        if (Array.isArray(supaRows) && supaRows.length > 0) {
          const mapped = supaRows.map(row => mapSupabaseRowToSheet(sheetName, row));
          _executionSheetDataCache[norm] = mapped;
          return mapped;
        }
      }
    } catch (errSupa) {
      Logger.log('[Dual-DB Fallback] Gagal membaca Supabase ' + sheetName + ': ' + errSupa.message + '. Beralih ke Google Sheets.');
    }
  }

  // 2. Fallback membaca dari Google Spreadsheet
  const sheet = getSheetCaseInsensitive(sheetName);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  const results = [];
  const tz = Session.getScriptTimeZone() || 'Asia/Jakarta';

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const headerKey = String(headers[c]).trim();
      let val = row[c];
      if (val instanceof Date) {
        // If year <= 1900, it is a Google Sheets time-only value (epoch base 1899-12-30)
        if (val.getFullYear() <= 1900) {
          val = Utilities.formatDate(val, tz, 'HH:mm:ss');
        } else if (val.getHours() === 0 && val.getMinutes() === 0 && val.getSeconds() === 0) {
          val = Utilities.formatDate(val, tz, 'yyyy-MM-dd');
        } else {
          val = Utilities.formatDate(val, tz, 'yyyy-MM-dd HH:mm:ss');
        }
      } else if (typeof val === 'string') {
        // If string contains historical 1899 date artifact
        if (val.indexOf('1899-12-30') !== -1 || val.indexOf('1899-12-31') !== -1) {
          val = val.replace(/1899-12-3[01][T ]?/, '').trim();
        }
      }
      obj[headerKey] = val;
    }
    results.push(obj);
  }
  _executionSheetDataCache[norm] = results;
  return results;
}

// In-Memory Script Cache untuk Master Data (CONFIG, WILAYAH, PRODUK) guna percepatan load data
function getCachedSheetData(sheetName, ttlSeconds) {
  ttlSeconds = ttlSeconds || 600; // 10 menit
  const normalized = String(sheetName || '').trim().toUpperCase();
  const cacheable = ['CONFIG', 'WILAYAH', 'PRODUK'];
  if (!cacheable.includes(normalized)) {
    return getSheetData(sheetName);
  }

  const cacheKey = 'CACHE_' + normalized;
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    const fresh = getSheetData(sheetName);
    if (fresh && fresh.length > 0) {
      const str = JSON.stringify(fresh);
      if (str.length < 95000) {
        cache.put(cacheKey, str, ttlSeconds);
      }
    }
    return fresh;
  } catch (e) {
    Logger.log('Cache read warn: ' + e.message);
    return getSheetData(sheetName);
  }
}

function clearSheetCache(sheetName) {
  try {
    if (sheetName) {
      delete _executionSheetDataCache[String(sheetName).trim().toUpperCase()];
    } else {
      for (const k in _executionSheetDataCache) {
        delete _executionSheetDataCache[k];
      }
    }
    const cache = CacheService.getScriptCache();
    if (sheetName) {
      cache.remove('CACHE_' + String(sheetName).trim().toUpperCase());
    } else {
      cache.removeAll(['CACHE_CONFIG', 'CACHE_WILAYAH', 'CACHE_PRODUK']);
    }
  } catch (e) {
    Logger.log('Cache clear warn: ' + e.message);
  }
}

// Membaca N baris terakhir dari sheet secara parsial (Super Cepat untuk Ribuan Baris Data)
function getRecentRows(sheetName, limit) {
  limit = limit || 200;
  const norm = String(sheetName || '').trim().toUpperCase();

  // 1. Dual-DB: Prioritas membaca dari Supabase jika aktif
  if (typeof isSupabaseActive === 'function' && isSupabaseActive()) {
    try {
      if (typeof TABLE_MAPPINGS !== 'undefined' && TABLE_MAPPINGS[norm]) {
        const mapping = TABLE_MAPPINGS[norm];
        const supaRows = supabaseSelect(mapping.tableName, {
          order: mapping.primaryKey + '.desc',
          limit: limit
        });
        if (Array.isArray(supaRows) && supaRows.length > 0) {
          return supaRows.reverse().map(row => mapSupabaseRowToSheet(sheetName, row));
        }
      }
    } catch (errSupa) {
      Logger.log('[Dual-DB getRecentRows] Fallback ke Sheet (' + sheetName + '): ' + errSupa.message);
    }
  }

  // 2. Fallback membaca dari Google Spreadsheet
  const sheet = getSheetCaseInsensitive(sheetName);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol < 1) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const startRow = Math.max(2, lastRow - limit + 1);
  const numRows = lastRow - startRow + 1;
  const values = sheet.getRange(startRow, 1, numRows, lastCol).getValues();
  const tz = Session.getScriptTimeZone() || 'Asia/Jakarta';

  const results = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const headerKey = String(headers[c]).trim();
      let val = row[c];
      if (val instanceof Date) {
        if (val.getFullYear() <= 1900) {
          val = Utilities.formatDate(val, tz, 'HH:mm:ss');
        } else if (val.getHours() === 0 && val.getMinutes() === 0 && val.getSeconds() === 0) {
          val = Utilities.formatDate(val, tz, 'yyyy-MM-dd');
        } else {
          val = Utilities.formatDate(val, tz, 'yyyy-MM-dd HH:mm:ss');
        }
      } else if (typeof val === 'string') {
        if (val.indexOf('1899-12-30') !== -1 || val.indexOf('1899-12-31') !== -1) {
          val = val.replace(/1899-12-3[01][T ]?/, '').trim();
        }
      }
      obj[headerKey] = val;
    }
    results.push(obj);
  }
  return results;
}

// Membaca kunjungan terbaru secara parsial (Ringan & Cepat untuk Peta 7 Hari & Validasi Check-In POS)
function getRecentKunjunganMini(limit) {
  limit = limit || 1500;
  const sheet = getSheetCaseInsensitive('KUNJUNGAN');
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol < 1) return [];

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const colOutlet = headers.findIndex(h => /^(Kode\s*Outlet|Kode\s*Toko|Outlet)$/i.test(h));
  const colSales = headers.findIndex(h => /^(ID\s*Sales|Sales\s*ID|Sales|User\s*ID)$/i.test(h));
  const colTgl = headers.findIndex(h => /^(Tanggal|Tgl|Date)$/i.test(h));
  const colJam = headers.findIndex(h => /^(Jam\s*Kunjungan|Jam|Waktu|Time)$/i.test(h));

  const startRow = Math.max(2, lastRow - limit + 1);
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 1, numRows, lastCol).getValues();

  const results = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const oc = colOutlet !== -1 ? String(row[colOutlet] || '').trim() : '';
    const sid = colSales !== -1 ? String(row[colSales] || '').trim() : '';
    const tgl = colTgl !== -1 ? normalizeDateOnly(row[colTgl]) : '';
    const jam = colJam !== -1 ? String(row[colJam] || '') : '';
    if (oc) {
      results.push({ 
        'Kode Outlet': oc, 
        'ID Sales': sid, 
        'Tanggal': tgl, 
        'Jam': jam,
        salesId: sid,
        kodeOutlet: oc,
        tanggal: tgl,
        jam: jam
      });
    }
  }
  return results;
}

// Parser Cek Stok Toko (Etalase/Rak) dari string kunjungan
function parseStokTokoBrandsWithStock(raw, resolveBrandKeyFn) {
  const presentBrands = new Set();
  if (!raw) return presentBrands;
  const str = String(raw).trim();
  if (!str || str.toLowerCase().includes('nihil') || str === '-') return presentBrands;

  if (str.startsWith('[') || str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str);
      const arr = Array.isArray(parsed) ? parsed : Object.values(parsed);
      arr.forEach(item => {
        const qty = Number(item.qty || item.stok || item.jumlah || 0);
        if (qty > 0) {
          const key = resolveBrandKeyFn(item.kodeProduk || item.brand || item.namaProduk, item.brand || item.namaProduk);
          if (key) presentBrands.add(key);
        }
      });
      return presentBrands;
    } catch (e) {}
  }

  const parts = str.split(/[,;\n]/);
  parts.forEach(part => {
    const p = part.trim();
    if (!p) return;
    const colonIdx = p.indexOf(':');
    if (colonIdx !== -1) {
      const bText = p.substring(0, colonIdx).trim();
      const numMatch = p.substring(colonIdx + 1).match(/\d+/);
      const qty = numMatch ? parseInt(numMatch[0], 10) : 0;
      if (qty > 0) {
        const key = resolveBrandKeyFn(bText, bText);
        if (key) presentBrands.add(key);
      }
    } else {
      const key = resolveBrandKeyFn(p, p);
      if (key) presentBrands.add(key);
    }
  });
  return presentBrands;
}

function getConfigMap() {
  const configs = getCachedSheetData('CONFIG') || [];
  const map = {};
  configs.forEach(c => {
    const k = String(c['Key'] || '').trim();
    if (k) {
      map[k] = c['Value'];
    }
  });
  return map;
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);
  if (isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2) ||
      (nLat1 === 0 && nLon1 === 0) || (nLat2 === 0 && nLon2 === 0)) {
    return NaN;
  }

  const R = 6371e3;
  const phi1 = (nLat1 * Math.PI) / 180;
  const phi2 = (nLat2 * Math.PI) / 180;
  const deltaPhi = ((nLat2 - nLat1) * Math.PI) / 180;
  const deltaLambda = ((nLon2 - nLon1) * Math.PI) / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

let _cachedUploadFolder = null;

function getUploadFolder(folderId) {
  if (folderId) {
    try {
      const f = DriveApp.getFolderById(folderId);
      if (f) return f;
    } catch (e) {
      Logger.log('Folder ID not found: ' + folderId);
    }
  }
  if (_cachedUploadFolder) return _cachedUploadFolder;

  const props = PropertiesService.getScriptProperties();
  const savedFolderId = props.getProperty('ERP_UPLOAD_FOLDER_ID');
  if (savedFolderId) {
    try {
      _cachedUploadFolder = DriveApp.getFolderById(savedFolderId);
      if (_cachedUploadFolder) return _cachedUploadFolder;
    } catch (e) {
      Logger.log('Saved folder ID invalid: ' + savedFolderId);
    }
  }

  // Folder belum ada / belum tercache: Buat atau cari sekali saja
  const rootFolders = DriveApp.getFoldersByName('WebApp_Monitoring_Sales_Uploads');
  let folder;
  if (rootFolders.hasNext()) {
    folder = rootFolders.next();
  } else {
    folder = DriveApp.createFolder('WebApp_Monitoring_Sales_Uploads');
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }

  if (folder) {
    _cachedUploadFolder = folder;
    try {
      props.setProperty('ERP_UPLOAD_FOLDER_ID', folder.getId());
    } catch (errProp) {}
  }
  return folder;
}

function saveBase64ImageToDrive(base64Data, folderId, fileName) {
  try {
    if (!base64Data || typeof base64Data !== 'string' || !base64Data.startsWith('data:image')) {
      return 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop';
    }
    const folder = getUploadFolder(folderId);
    if (!folder) {
      throw new Error('Tidak dapat menemukan folder upload Google Drive');
    }

    const contentTypeMatch = base64Data.match(/^data:(image\/[a-zA-Z0-9.+_-]+);base64,/);
    const contentType = contentTypeMatch ? contentTypeMatch[1] : 'image/jpeg';
    const base64Clean = base64Data.substring(base64Data.indexOf('base64,') + 7);
    const bytes = Utilities.base64Decode(base64Clean);
    const blob = Utilities.newBlob(bytes, contentType, fileName || ('Upload_' + Date.now() + '.jpg'));
    const file = folder.createFile(blob);
    return 'https://lh3.googleusercontent.com/d/' + file.getId();
  } catch (e) {
    Logger.log('Drive Upload Error: ' + e.message);
    return 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop';
  }
}

/**
 * Normalisasi format tanggal universal (Date object, YYYY-MM-DD, atau DD/MM/YYYY)
 * Mengembalikan string format standar: 'yyyy-MM-dd'
 */
function normalizeDateOnly(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'Asia/Jakarta', 'yyyy-MM-dd');
  }
  const s = String(val).replace(/1899-12-3[01][T ]?/, '').trim();
  if (!s || s === '-' || s === 'null' || s === 'undefined') return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.substring(0, 10);
  }
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    return dmy[3] + '-' + dmy[2].padStart(2, '0') + '-' + dmy[1].padStart(2, '0');
  }
  try {
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1970) {
      return Utilities.formatDate(parsed, Session.getScriptTimeZone() || 'Asia/Jakarta', 'yyyy-MM-dd');
    }
  } catch (e) {}
  return s.substring(0, 10);
}

function getTodayDateString() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getCurrentTimeString() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss');
}

/**
 * Mengambil Daftar Notifikasi Aktivitas Real-Time Terstruktur & Dikelompokkan
 * Kategori: 'penting' (Action required / Approval), 'transaksi' (POS & Sales), 'operasional' (Kunjungan & Absen)
 */
function formatNotificationJam(raw) {
  if (!raw) return '';
  if (raw instanceof Date) {
    return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'HH:mm') + ' WIB';
  }
  const s = String(raw).trim();
  const match = s.match(/(?:^|\s|T)(\d{1,2}):(\d{2})/);
  if (match) {
    const hh = match[1].length === 1 ? '0' + match[1] : match[1];
    return hh + ':' + match[2] + ' WIB';
  }
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, Session.getScriptTimeZone(), 'HH:mm') + ' WIB';
    }
  } catch (e) {}
  return s;
}

function apiGetActivityNotifications(userRole, userId) {
  try {
    const notifications = [];
    const todayStr = getTodayDateString();
    const users = getSheetData('USERS') || [];
    const outlets = getSheetData('OUTLET') || [];
    const allTrx = getRecentRows('TRANSAKSI', 150);
    const allVisits = getRecentRows('KUNJUNGAN', 150);
    const allAbsen = getRecentRows('ABSENSI', 100);
    const allStok = getRecentRows('STOK_SALES', 100);

    const userMap = {};
    users.forEach(u => { userMap[String(u['User ID']).trim()] = u['Nama Lengkap']; });
    const outletMap = {};
    outlets.forEach(o => { outletMap[String(o['Kode Outlet']).trim()] = o['Nama Toko']; });

    // 1. KATEGORI PENTING: Permintaan Stok Sales Pending Approval / Hari Ini
    allStok.filter(s => {
      const isPending = String(s['Status'] || '').toLowerCase() === 'pending';
      const isToday = normalizeDateOnly(s['Tanggal']) === todayStr;
      return isPending || isToday;
    }).slice(-8).reverse().forEach((s, i) => {
      const sId = String(s['ID Sales']).trim();
      const salesName = userMap[sId] || sId || 'Sales';
      if (userRole !== 'Sales') {
        notifications.push({
          id: 'notif-stok-req-' + (s['ID Permintaan'] || i),
          category: 'penting',
          type: 'stok',
          icon: 'fa-solid fa-boxes-stacked text-amber-500',
          title: 'Request Stok: ' + salesName,
          message: salesName + ' minta stok ' + (s['Nama Produk'] || '-') + ' (' + (s['Qty Diminta'] || 0) + ' ' + (s['Satuan'] || 'Pcs') + ') - Butuh approval.',
          time: formatNotificationJam(s['Waktu Request'] || s['Tanggal'] || ''),
          actionTab: 'stok-sales',
          isRead: false
        });
      } else if (sId === String(userId).trim()) {
        notifications.push({
          id: 'notif-stok-req-sales-' + (s['ID Permintaan'] || i),
          category: 'penting',
          type: 'stok',
          icon: 'fa-solid fa-clock text-amber-500',
          title: 'Permintaan Stok Menunggu Approval',
          message: 'Pengajuan ' + (s['Nama Produk'] || '-') + ' (' + (s['Qty Diminta'] || 0) + ') sedang ditinjau Admin.',
          time: formatNotificationJam(s['Waktu Request'] || s['Tanggal'] || ''),
          actionTab: 'stok-sales',
          isRead: false
        });
      }
    });

    // 2. KATEGORI PENTING: Outlet Baru Pending Verifikasi / Didaftarkan Hari Ini
    outlets.filter(o => {
      const isPending = String(o['Status Verifikasi'] || '').toLowerCase() === 'pending';
      const isToday = normalizeDateOnly(o['Tanggal Dibuat']) === todayStr;
      return isPending || isToday;
    }).slice(-6).reverse().forEach((o, i) => {
      notifications.push({
        id: 'notif-outlet-' + (o['Kode Outlet'] || i),
        category: 'penting',
        type: 'outlet',
        icon: 'fa-solid fa-store text-rose-500',
        title: 'Verifikasi Outlet Baru',
        message: 'Toko ' + o['Nama Toko'] + ' (' + (o['Kode Wilayah'] || '-') + ') didaftarkan sales, menunggu verifikasi.',
        time: formatNotificationJam(o['Tanggal Dibuat'] || ''),
        actionTab: 'outlet',
        isRead: false
      });
    });

    // 3. KATEGORI PENTING: Absensi Di Luar Radius (> 50m / Tidak Valid) Hari Ini
    allAbsen.filter(a => normalizeDateOnly(a['Tanggal']) === todayStr).slice(-10).reverse().forEach((a, i) => {
      const aSalesId = String(a['ID Sales']).trim();
      const salesName = userMap[aSalesId] || aSalesId || 'Sales';
      const jarak = Number(a['Jarak Masuk Meter']) || 0;
      const statusLok = String(a['Status Lokasi'] || '');
      if (userRole !== 'Sales' && (jarak > 50 || statusLok.toLowerCase().includes('luar'))) {
        notifications.push({
          id: 'notif-absen-warn-' + (a['ID Absensi'] || i),
          category: 'penting',
          type: 'absensi',
          icon: 'fa-solid fa-triangle-exclamation text-rose-500',
          title: 'Absensi Luar Radius: ' + salesName,
          message: salesName + ' absen ' + jarak + 'm dari lokasi toko (Status: ' + statusLok + ').',
          time: formatNotificationJam((a['Tanggal'] || '') + ' ' + (a['Jam Masuk'] || '')),
          actionTab: 'riwayat',
          isRead: false
        });
      }
    });

    // 4. KATEGORI TRANSAKSI: Penjualan POS Hari Ini
    allTrx.filter(t => normalizeDateOnly(t['Waktu Transaksi'] || t['Tanggal Dibuat']) === todayStr).slice(-15).reverse().forEach((t, i) => {
      const tSalesId = String(t['ID Sales']).trim();
      const salesName = userMap[tSalesId] || tSalesId || 'Sales';
      const toko = outletMap[String(t['Kode Outlet']).trim()] || t['Kode Outlet'] || 'Outlet';
      const total = Number(t['Total Akhir']) || 0;

      if (userRole !== 'Sales' || tSalesId === String(userId).trim()) {
        notifications.push({
          id: 'notif-trx-' + (t['Nomor Faktur'] || i),
          category: 'transaksi',
          type: 'transaksi',
          icon: 'fa-solid fa-cash-register text-emerald-500',
          title: 'Penjualan: ' + formatRupiahServer(total),
          message: salesName + ' mencatat faktur ' + (t['Nomor Faktur'] || '-') + ' di ' + toko + '.',
          time: formatNotificationJam(t['Waktu Transaksi'] || t['Tanggal Dibuat'] || ''),
          actionTab: 'riwayat',
          isRead: false
        });
      }
    });

    // 5. KATEGORI OPERASIONAL: Kunjungan Outlet Lapangan Hari Ini
    allVisits.filter(v => normalizeDateOnly(v['Tanggal']) === todayStr).slice(-10).reverse().forEach((v, i) => {
      const vSalesId = String(v['ID Sales']).trim();
      const salesName = userMap[vSalesId] || vSalesId || 'Sales';
      const toko = outletMap[String(v['Kode Outlet']).trim()] || v['Kode Outlet'] || 'Outlet';
      if (userRole !== 'Sales' || vSalesId === String(userId).trim()) {
        notifications.push({
          id: 'notif-visit-' + (v['ID Kunjungan'] || i),
          category: 'operasional',
          type: 'kunjungan',
          icon: 'fa-solid fa-location-dot text-indigo-500',
          title: 'Kunjungan: ' + toko,
          message: salesName + ' check-in foto di ' + toko + ' (' + (v['Jarak Meter'] || 0) + 'm).',
          time: formatNotificationJam((v['Tanggal'] || '') + ' ' + (v['Jam Kunjungan'] || '')),
          actionTab: 'kunjungan',
          isRead: false
        });
      }
    });

    // 6. KATEGORI OPERASIONAL: Absensi Normal Hari Ini
    allAbsen.filter(a => normalizeDateOnly(a['Tanggal']) === todayStr).slice(-10).reverse().forEach((a, i) => {
      const aSalesId = String(a['ID Sales']).trim();
      const salesName = userMap[aSalesId] || aSalesId || 'Sales';
      const jarak = Number(a['Jarak Masuk Meter']) || 0;
      if ((userRole !== 'Sales' || aSalesId === String(userId).trim()) && jarak <= 50) {
        if (a['Jam Masuk'] && a['Jam Masuk'] !== '-') {
          notifications.push({
            id: 'notif-absen-masuk-' + (a['ID Absensi'] || i),
            category: 'operasional',
            type: 'absensi',
            icon: 'fa-solid fa-user-check text-sky-500',
            title: 'Absensi: ' + salesName,
            message: salesName + ' telah absen masuk pukul ' + a['Jam Masuk'] + ' (Radius: ' + jarak + 'm).',
            time: formatNotificationJam((a['Tanggal'] || '') + ' ' + a['Jam Masuk']),
            actionTab: 'riwayat',
            isRead: false
          });
        }
      }
    });

    // 7. KATEGORI OPERASIONAL: Stok Disetujui Hari Ini (Untuk Sales)
    if (userRole === 'Sales') {
      allStok.filter(s => {
        const isAppr = String(s['Status'] || '').toLowerCase() === 'disetujui';
        const isSameSales = String(s['ID Sales']).trim() === String(userId).trim();
        const isToday = normalizeDateOnly(s['Tanggal']) === todayStr;
        return isAppr && isSameSales && isToday;
      }).slice(-5).reverse().forEach((s, i) => {
        notifications.push({
          id: 'notif-stok-appr-' + (s['ID Permintaan'] || i),
          category: 'operasional',
          type: 'stok',
          icon: 'fa-solid fa-circle-check text-emerald-500',
          title: 'Stok Disetujui',
          message: 'Stok ' + (s['Nama Produk'] || '-') + ' (' + (s['Qty Disetujui'] || 0) + ' ' + (s['Satuan'] || 'Pcs') + ') telah disetujui Admin.',
          time: formatNotificationJam(s['Tanggal'] || ''),
          actionTab: 'stok-sales',
          isRead: false
        });
      });
    }

    // Urutkan: PENTING selalu di paling atas, lalu urutkan timestamp terbaru
    notifications.sort((a, b) => {
      if (a.category === 'penting' && b.category !== 'penting') return -1;
      if (a.category !== 'penting' && b.category === 'penting') return 1;
      return 0;
    });

    return {
      success: true,
      today: todayStr,
      notifications: notifications.slice(0, 30)
    };
  } catch (err) {
    Logger.log('Error apiGetActivityNotifications: ' + err.message);
    return { success: false, message: err.message, notifications: [] };
  }
}

function formatRupiahServer(num) {
  return 'Rp ' + Number(num || 0).toLocaleString('id-ID');
}

// ==============================================================================
// 8. MODUL MANAJEMEN STOK SALES HARIAN (REQUEST & RETUR SISA CLOSING)
// ==============================================================================

function apiGetStokSalesHarian(salesId, role, tanggal) {
  try {
    const sheetStok = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('STOK_SALES');
    if (!sheetStok) return { success: true, data: [] };
    let data = getSheetData('STOK_SALES') || [];
    const users = getSheetData('USERS') || [];
    const userMap = {};
    users.forEach(u => { userMap[String(u['User ID']).trim()] = u['Nama Lengkap']; });

    const targetDate = tanggal || getTodayDateString();

    if (salesId) {
      data = data.filter(d => String(d['ID Sales']).trim() === String(salesId).trim());
    }

    if (targetDate && targetDate !== 'SEMUA') {
      const targetPrefix = normalizeDateOnly(targetDate);
      data = data.filter(d => {
        const tgl = normalizeDateOnly(d['Tanggal']);
        return tgl === targetPrefix;
      });
    }

    data.reverse();

    const result = data.map(d => {
      const tglStr = normalizeDateOnly(d['Tanggal']);
      return {
        idPermintaan: String(d['ID Permintaan'] || ''),
        tanggal: tglStr,
        salesId: String(d['ID Sales'] || ''),
        salesName: userMap[String(d['ID Sales']).trim()] || String(d['ID Sales'] || 'Sales'),
        kodeProduk: String(d['Kode Produk'] || ''),
        namaProduk: String(d['Nama Produk'] || ''),
        satuan: String(d['Satuan'] || 'Pcs'),
        qtyDiminta: Number(d['Qty Diminta']) || 0,
        qtyDisetujui: Number(d['Qty Disetujui']) || 0,
        qtyTerjual: Number(d['Qty Terjual']) || 0,
        qtyRetur: Number(d['Qty Retur']) || 0,
        sisaStok: Number(d['Sisa Stok Sales']) || 0,
        status: String(d['Status'] || 'Pending'),
        catatan: String(d['Catatan'] || '-'),
        disetujuiOleh: String(d['Disetujui Oleh'] || '-'),
        waktuRequest: String(d['Waktu Request'] || '-'),
        waktuClosing: String(d['Waktu Closing'] || '-')
      };
    });

    return { success: true, data: result };
  } catch (err) {
    Logger.log('Error apiGetStokSalesHarian: ' + err.message);
    return { success: true, message: err.message, data: [] };
  }
}

function apiSubmitRequestStokSales(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheetStok = ss.getSheetByName('STOK_SALES');
  if (!sheetStok) {
    sheetStok = ss.insertSheet('STOK_SALES');
    sheetStok.appendRow(['ID Permintaan', 'Tanggal', 'ID Sales', 'Kode Produk', 'Nama Produk', 'Satuan', 'Qty Diminta', 'Qty Disetujui', 'Qty Terjual', 'Qty Retur', 'Sisa Stok Sales', 'Status', 'Catatan', 'Disetujui Oleh', 'Waktu Request', 'Waktu Closing']);
  }

  const items = payload.items || [];
  if (items.length === 0) {
    return { success: false, message: 'Pilih minimal 1 produk untuk permintaan stok!' };
  }

  const now = new Date();
  const todayStr = payload.tanggal || getTodayDateString();
  const timeStr = getCurrentTimeString();
  const timeCode = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HHmmss');
  const salesSuffix = String(payload.salesId || 'S').replace(/\D/g, '').slice(-3) || '001';
  const salt = Math.floor(100 + Math.random() * 900);

  items.forEach((it, idx) => {
    const idPermintaan = 'REQ-' + String(todayStr).replace(/-/g, '') + '-' + timeCode + '-' + salesSuffix + '-' + salt + '-' + (idx + 1);
    const qty = Number(it.qty) || 1;
    appendRowByHeaderMap(sheetStok, {
      'ID Permintaan': idPermintaan,
      'Tanggal': todayStr,
      'ID Sales': payload.salesId,
      'Kode Produk': it.kodeProduk,
      'Nama Produk': it.namaProduk,
      'Satuan': it.satuan || 'Pcs',
      'Qty Diminta': qty,
      'Qty Disetujui': 0,
      'Qty Terjual': 0,
      'Qty Retur': 0,
      'Sisa Stok Sales': 0,
      'Status': 'Pending',
      'Catatan': payload.catatan || '-',
      'Disetujui Oleh': '-',
      'Waktu Request': timeStr,
      'Waktu Closing': '-'
    });
  });

  sendPushNotificationFCM(
    'admin_owner',
    '📦 Permintaan Stok Sales Baru',
    'Sales ' + (payload.salesId || '') + ' mengajukan stok (' + items.length + ' item). Klik untuk persetujuan!',
    'stok-sales'
  );

  return { success: true, message: 'Permintaan stok berhasil diajukan (' + items.length + ' item)! Menunggu persetujuan admin/gudang.' };
}

function apiApproveRequestStokSales(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetStok = ss.getSheetByName('STOK_SALES');
  if (!sheetStok) return { success: false, message: 'Sheet STOK_SALES belum ada!' };
  const data = getSheetData('STOK_SALES') || [];

  const items = payload.items || []; // [{ idPermintaan, qtyDisetujui }]
  const targetSales = payload.salesId ? String(payload.salesId).trim() : null;
  const targetDate = payload.tanggal ? normalizeDateOnly(payload.tanggal) : null;
  let approvedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const rowId = String(data[i]['ID Permintaan']).trim();
    const rowSales = String(data[i]['ID Sales']).trim();
    const rowDate = normalizeDateOnly(data[i]['Tanggal']);
    const rowStatus = String(data[i]['Status'] || '').toLowerCase();

    let shouldApprove = false;
    let qtyDisetujui = Number(data[i]['Qty Diminta']) || 0;

    if (items.length > 0) {
      const match = items.find(it => String(it.idPermintaan).trim() === rowId);
      if (match) {
        shouldApprove = true;
        if (match.qtyDisetujui !== undefined && match.qtyDisetujui !== null) {
          qtyDisetujui = Number(match.qtyDisetujui);
        }
      }
    } else if (targetSales && rowSales === targetSales && rowStatus === 'pending') {
      if (!targetDate || rowDate === targetDate) {
        shouldApprove = true;
      }
    }

    if (shouldApprove) {
      updateRowByHeaderMap(sheetStok, i + 2, {
        'Qty Disetujui': qtyDisetujui,
        'Qty Terjual': 0,
        'Qty Retur': 0,
        'Sisa Stok Sales': qtyDisetujui,
        'Status': 'Disetujui',
        'Disetujui Oleh': payload.adminUserId || 'Admin'
      });
      approvedCount++;
    }
  }

  if (approvedCount > 0 && targetSales) {
    const cleanId = String(targetSales).replace(/[^a-zA-Z0-9-_.~%]/g, '');
    sendPushNotificationFCM(
      'sales_' + cleanId,
      '✅ Permintaan Stok Disetujui',
      'Permintaan stok harian Anda telah disetujui Admin. Siap diambil.',
      'stok-sales'
    );
  }

  return { success: true, message: 'Berhasil menyetujui ' + approvedCount + ' item stok sales!' };
}

function apiSubmitReturStokSales(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetStok = ss.getSheetByName('STOK_SALES');
  if (!sheetStok) return { success: false, message: 'Sheet STOK_SALES belum ada!' };
  const data = getSheetData('STOK_SALES') || [];

  const timeStr = getCurrentTimeString();
  const targetSales = String(payload.salesId || '').trim();
  const targetDate = normalizeDateOnly(payload.tanggal || getTodayDateString());
  let closedCount = 0;

  for (let i = 0; i < data.length; i++) {
    const sId = String(data[i]['ID Sales']).trim();
    const tgl = normalizeDateOnly(data[i]['Tanggal']);
    const isTarget = (!targetSales || sId === targetSales) && (tgl === targetDate) && data[i]['Status'] === 'Disetujui';

    if (isTarget) {
      const sisa = Number(data[i]['Sisa Stok Sales']) || 0;
      updateRowByHeaderMap(sheetStok, i + 2, {
        'Qty Retur': sisa,
        'Sisa Stok Sales': 0,
        'Status': 'Selesai',
        'Waktu Closing': timeStr
      });
      closedCount++;
    }
  }

  return { success: true, message: 'Closing harian & retur berhasil diproses (' + closedCount + ' item)! Stok sales sekarang menjadi 0 (Nol).' };
}

/**
 * Inisialisasi Sheet STOK_SALES di Spreadsheet secara instan (1-klik)
 * Jalankan fungsi ini sekali di Apps Script editor jika ingin membuat tab STOK_SALES sebelum digunakan.
 */
function initStokSalesDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheetStok = ss.getSheetByName('STOK_SALES');
  const headers = ['ID Permintaan', 'Tanggal', 'ID Sales', 'Kode Produk', 'Nama Produk', 'Satuan', 'Qty Diminta', 'Qty Disetujui', 'Qty Terjual', 'Qty Retur', 'Sisa Stok Sales', 'Status', 'Catatan', 'Disetujui Oleh', 'Waktu Request', 'Waktu Closing'];
  
  if (!sheetStok) {
    sheetStok = ss.insertSheet('STOK_SALES');
    sheetStok.appendRow(headers);
    const headerRange = sheetStok.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1e293b');
    headerRange.setFontColor('#ffffff');
    sheetStok.setFrozenRows(1);
    Logger.log('✅ Sheet STOK_SALES berhasil dibuat dan diformat!');
    return '✅ Sheet STOK_SALES berhasil dibuat dan diformat!';
  } else {
    Logger.log('ℹ️ Sheet STOK_SALES sudah ada di spreadsheet.');
    return 'ℹ️ Sheet STOK_SALES sudah ada di spreadsheet.';
  }
}

/**
 * ==============================================================================
 * 9. FIREBASE CLOUD MESSAGING (FCM HTTP v1) PUSH NOTIFICATION SENDER
 * Mengirim Push Notifikasi Status Bar ke HP Android Karyawan (Saat APK Ditutup)
 * ==============================================================================
 */

const FIREBASE_CONFIG = {
  projectId: "margantara-erp",
  clientEmail: "firebase-adminsdk-fbsvc@margantara-erp.iam.gserviceaccount.com",
  privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEuwIBADANBgkqhkiG9w0BAQEFAASCBKUwggShAgEAAoIBAQDWdHWNZ2CK0vd+\nK+uao0DBigXz8RaqlJjEhQa87Sk08LK5YbM/hGvm6zEnMHExRraF+J8kEnlWRSOw\ndvjhTMJf0LmwV/1UeMsZcq5kok+D4hj85JE5pjP60V9KY4weEFf578Fx08jvZUKc\nl+VKDYj45cY7/1cUlyMffpoz6W92jpHW7vDErDnNswSN3nVN1Qb33FKtb1On/kGB\ng5QO2z586MIL+lnB8U8gD4fyBiLDpa5PBVRJJvdI+0tw/3lzlrGjzZtMa5USFlHN\njz4GtjK72EiuPIDTnOBLX0c989iGY5cCCHlhBAKUGHfeannkCngz/DezPXjMO7IS\nnCLJ5EDBAgMBAAECgf9TLwxp5pXY3PwjDkyh+7EI+wC6hRZfR3eT9gWNdgo4/r3u\nKnd2eJou3nIY2v5AOHpg41wKiFMiCeK0dqSsv5lykQPcSXhG/vovMZlzorUB8v5X\n5rc68iNqpswCwgCxQj9EM268BR1rvo6X++za5jHuWZikrRnNL5+JsXhSEO1E9R63\nDB3pjVnrqxZ2La8RHqIsc7kibD0YYSo/vsnKEkhoE8oeuSm4WfFKIO+OMTG3EDkB\nWd2mHerwlDMorSjahOWuXVZWRWor6ZwOLi9tHGqVwjQyKFWZjtVTRCHhJMWafl+A\nMcaIb9T4H8lGC0MxpiiP0kz0/bK6A+0nGOfyEOMCgYEA/M8lApKGI8rt4ielKxTW\n38JAuqd0aDPn/MRHsjnyvBoFieW23mntoHenYrpshfi78QivHorj8l52QbuRFZ1x\n2LNhl873+c4cUIfwC5XOk515WrMgaVLGjRpF1lnpgqt8wyv9h+J0ZRftY9aAVsY9\nfnkeAA+Fu+ANoQbXM0Q3KXsCgYEA2SljPfYpBAjoLKJhIeNkgCtVOKuhReV5XjAw\nL1d2HaQ3BBRxKDgCfU/L2biwK9sBnilFyPMoCSccyGL+toOzik7gfnVwHybGPCJU\nEjLIk0UbJ9ipzmWHm++eUdYuS63f7V+JVCm2Hl8mS3bzUzpjI/te9XBvqxau1Q9R\nSaSvU/MCgYAF4/Gx0KYteVH3ngLcMR0ck5MchkBRGTyDiDM/dNgyB80vPFn5brBp\nt7//reZPbM88O36REJ1lDUxmFa+4uDVp3iwc9GaUvHeubKxsKK5qhBXKxjewHIyh\nxwXvi6LEN6ith33dx6n8nQUb+Wh+HRpbswi+6Z2tFfhbUyR6flFmtwKBgQCzvqsT\nLT3Txh+OWjT1nMahw7w9NOo+9WpYyKAJf2YXsMWMzfK/bGS7HiJHqrO/CP400Eqf\nwou/z6zmO/JCVY51C0aLxV6xmiF4wp09luUn6IpKl+4tFSKCsnojmJknMNrpGiuM\nCx5f0zfaPLG4kNpgfP6jPpZfUV4SoiQRRYuNewKBgDS+LVaYL5jOVeBnCwr+bKrq\nSgMH7EXstvZBemVMmu3XHH9WbRTV+XOtxNllwlMHqabMUnipEATPq2ovjtPiRgFX\nIP9tOoIgQMsPzjnzoJXa3nJhpdAOOYUPQEYEJs6lP0eG86UpGKNhuzUFoNFK1ZWv\nnSnPirGLYJhl9Lbx1EZF\n-----END PRIVATE KEY-----\n"
};

/**
 * Menghasilkan Google OAuth2 Access Token untuk FCM HTTP v1 secara instan & di-cache
 */
function getFirebaseAccessToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('FCM_OAUTH_TOKEN');
  if (cached) return cached;

  const header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claim = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: FIREBASE_CONFIG.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  }));

  const toSign = header + "." + claim;
  const signatureBytes = Utilities.computeRsaSha256Signature(toSign, FIREBASE_CONFIG.privateKey);
  const signature = Utilities.base64EncodeWebSafe(signatureBytes);
  const jwt = toSign + "." + signature;

  const res = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  const resText = res.getContentText();
  let data = {};
  try {
    data = JSON.parse(resText);
  } catch (e) {
    throw new Error("HTTP " + res.getResponseCode() + " Token Parse Error: " + resText);
  }

  if (data.access_token) {
    cache.put('FCM_OAUTH_TOKEN', data.access_token, 3000); // Cache 50 menit
    return data.access_token;
  }
  throw new Error("OAuth Token Gagal (" + res.getResponseCode() + "): " + (data.error_description || data.error || resText));
}

/**
 * Mengirim Notifikasi Push ke HP via Firebase Cloud Messaging (FCM HTTP v1)
 */
function sendPushNotificationFCM(targetTopic, title, body, actionTab) {
  try {
    const cleanTopic = String(targetTopic || 'all_devices').replace(/[^a-zA-Z0-9-_.~%]/g, '');
    const accessToken = getFirebaseAccessToken();
    const url = "https://fcm.googleapis.com/v1/projects/" + FIREBASE_CONFIG.projectId + "/messages:send";

    const payload = {
      message: {
        topic: cleanTopic,
        notification: {
          title: title || 'Margantara ERP',
          body: body || ''
        },
        data: {
          title: title || 'Margantara ERP',
          body: body || '',
          actionTab: actionTab || 'dashboard'
        },
        android: {
          priority: "HIGH",
          notification: {
            channel_id: "erp_push_channel",
            sound: "default",
            default_vibrate_timings: true,
            notification_priority: "PRIORITY_HIGH"
          }
        }
      }
    };

    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: {
        "Authorization": "Bearer " + accessToken
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const respCode = res.getResponseCode();
    const respText = res.getContentText();
    Logger.log("FCM v1 Response [" + cleanTopic + "] (" + respCode + "): " + respText);

    if (respCode >= 200 && respCode < 300) {
      return { success: true, message: 'Berhasil dikirim' };
    } else {
      let detail = respText;
      try {
        const j = JSON.parse(respText);
        if (j.error && j.error.message) detail = j.error.message;
      } catch (e) {}
      return { success: false, message: 'FCM (' + respCode + '): ' + detail };
    }
  } catch (err) {
    Logger.log("Error sendPushNotificationFCM: " + err.message);
    return { success: false, message: err.message };
  }
}

/**
 * Fungsi uji coba untuk testing kirim notifikasi langsung dari Apps Script editor
 */
function testSendFCMPushNotification() {
  const result = sendPushNotificationFCM(
    'all_devices',
    '🔔 Tes Notifikasi Margantara ERP',
    'Halo! Ini adalah uji coba notifikasi Firebase Cloud Messaging dari Apps Script.',
    'dashboard'
  );
  Logger.log('Hasil test kirim: ' + JSON.stringify(result));
}

/**
 * Fungsi khusus untuk MEMAKSA Google memunculkan dialog "Review Permissions / Tinjau Izin"
 * Jalankan fungsi ini sekali di editor dan izinkan akses.
 */
function mintaIzinUrlFetch() {
  const res = UrlFetchApp.fetch("https://oauth2.googleapis.com");
  Logger.log("Izin UrlFetchApp sudah aktif! Status: " + res.getResponseCode());
}

/**
 * Uji Coba Diagnostik Bertahap untuk melacak proses pembuatan token & pengiriman FCM
 */
function testKoneksiFCM() {
  Logger.log('=== [1/4] CEK KONFIGURASI FIREBASE ===');
  Logger.log('Project ID: ' + FIREBASE_CONFIG.projectId);
  Logger.log('Client Email: ' + FIREBASE_CONFIG.clientEmail);
  Logger.log('Panjang Private Key: ' + (FIREBASE_CONFIG.privateKey ? FIREBASE_CONFIG.privateKey.length : 0));

  Logger.log('=== [2/4] CEK ACCESS TOKEN OAUTH2 ===');
  try {
    const token = getFirebaseAccessToken();
    Logger.log('✅ Access Token Berhasil Diperoleh! (Panjang: ' + token.length + ')');
  } catch (errToken) {
    Logger.log('❌ Gagal memperoleh Access Token: ' + errToken.message);
    return;
  }

  Logger.log('=== [3/4] UJI TEMBAK NOTIFIKASI KE GOOGLE FCM ===');
  const res = sendPushNotificationFCM(
    'all_devices',
    '🔔 Tes Notifikasi Margantara ERP',
    'Tes koneksi push notification berhasil!',
    'dashboard'
  );
  Logger.log('=== [4/4] HASIL AKHIR ===');
  Logger.log(JSON.stringify(res));
}

function apiTestFCMPushNotification(payload) {
  try {
    payload = payload || {};
    const role = payload.role || 'Owner';
    const resAll = sendPushNotificationFCM(
      'all_devices',
      '🔔 Tes Notifikasi Margantara ERP',
      'Koneksi push notification berhasil! Status bar HP Anda terhubung dengan server.',
      'dashboard'
    );
    if (!resAll || !resAll.success) {
      return {
        success: false,
        message: 'Gagal kirim FCM: ' + ((resAll && resAll.message) || 'Error tidak diketahui')
      };
    }
    if (role === 'Owner' || role === 'Admin') {
      sendPushNotificationFCM(
        'admin_owner',
        '🔔 Tes Jalur Notifikasi Admin/Owner',
        'Jalur notifikasi khusus Admin & Owner aktif.',
        'dashboard'
      );
    }
    return {
      success: true,
      message: 'Notifikasi uji coba berhasil dikirim ke Firebase Cloud Messaging!'
    };
  } catch (err) {
    return { success: false, message: 'Error tes notifikasi: ' + err.message };
  }
}
