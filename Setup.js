/**
 * ==============================================================================
 * SETUP.GS - Inisialisasi & Safe Migration Database Google Sheets
 * WebApp Monitoring Sales, POS & Absensi Toko (Penawaran 3 - Professional)
 * ==============================================================================
 * CARA MENJALANKAN DI GOOGLE APPS SCRIPT:
 * 1. Di toolbar atas sebelah tombol "Run / Debug", pilih fungsi: "setupDatabase" atau "runSafeMigration".
 * 2. Klik tombol "Run" (▶).
 * ==============================================================================
 */

// Fungsi Utama: setupDatabase (Bisa dijalankan langsung di Apps Script)
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Inisialisasi atau Dapatkan Folder Google Drive untuk Upload Foto
  const driveFolders = createOrGetDriveFolderStructure();
  
  // 2. Definisi Skema Sheet & Header Kolom (Format Bersih Tanpa Underscore)
  const schema = [
    {
      sheetName: 'CONFIG',
      headers: ['Key', 'Value', 'Keterangan'],
      seedData: [
        ['Nama Aplikasi', 'TokoTrack Pro', 'Nama judul webapp pada header dan login screen'],
        ['Logo URL', 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png', 'URL gambar logo webapp (transparan/PNG)'],
        ['Nama Perusahaan', 'PT Mitra Niaga Distribusi', 'Nama instansi / bisnis resmi'],
        ['Alamat Kantor', 'Jl. Pemuda No. 45, Surabaya, Jawa Timur', 'Alamat base office utama'],
        ['Link Google Maps Kantor', 'https://maps.google.com/?q=-7.265432,112.748901', 'Link Google Maps titik lokasi kantor'],
        ['Latitude Kantor', '-7.265432', 'Titik koordinat latitude kantor untuk absensi'],
        ['Longitude Kantor', '112.748901', 'Titik koordinat longitude kantor untuk absensi'],
        ['Radius Default Kantor Meter', '100', 'Batas maksimal radius absensi (meter)'],
        ['Nama Bank', 'Bank BCA', 'Nama bank untuk pembayaran transfer pelanggan'],
        ['Nomor Rekening', '8735091234', 'Nomor rekening bank penerima'],
        ['Atas Nama Rekening', 'PT Mitra Niaga Distribusi', 'Nama pemilik rekening bank'],
        ['QRIS Image URL', 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=00020101021126580016ID.CO.QRIS.WWW01189360091100213052825204599953033605802ID5919MITRA_NIAGA_DISTRIB6008SURABAYA61056024162070703A0163046F9A', 'Link barcode QRIS untuk pembayaran digital'],
        ['Folder ID Absensi', driveFolders.absensiFolderId, 'Google Drive Folder ID untuk foto absensi'],
        ['Folder ID Kunjungan', driveFolders.kunjunganFolderId, 'Google Drive Folder ID untuk foto kunjungan'],
        ['Folder ID Display', driveFolders.displayFolderId, 'Google Drive Folder ID untuk foto display etalase'],
        ['Versi Sistem', '3.0 - Professional', 'Versi aplikasi']
      ]
    },
    {
      sheetName: 'USERS',
      headers: ['User ID', 'Username', 'Password Hash', 'Nama Lengkap', 'Role', 'Kode Wilayah', 'Nomor HP', 'Status', 'Tanggal Dibuat'],
      seedData: [
        ['USR-001', 'owner', 'owner123', 'Budi Santoso (Owner)', 'Owner', 'SEMUA', '081234567890', 'Aktif', new Date().toISOString()],
        ['USR-002', 'admin', 'admin123', 'Siti Rahma (Admin)', 'Admin', 'SEMUA', '081234567891', 'Aktif', new Date().toISOString()],
        ['USR-003', 'sales1', 'sales123', 'Rahman Hakim (Sales)', 'Sales', 'SBY', '081234567892', 'Aktif', new Date().toISOString()],
        ['USR-004', 'sales2', 'sales123', 'Deni Prasetyo (Sales)', 'Sales', 'SDA', '081234567893', 'Aktif', new Date().toISOString()],
        ['USR-005', 'sales3', 'sales123', 'Anton Wibowo (Sales)', 'Sales', 'MLG', '081234567894', 'Aktif', new Date().toISOString()]
      ]
    },
    {
      sheetName: 'WILAYAH',
      headers: ['Kode Wilayah', 'Nama Wilayah', 'Nama Kabupaten', 'Provinsi', 'Keterangan', 'Link Google Maps Kantor', 'Latitude Kantor', 'Longitude Kantor', 'Radius Absensi', 'Nama Bank', 'Nomor Rekening', 'Atas Nama Rekening', 'QRIS Image URL', 'Status', 'Tanggal Dibuat'],
      seedData: [
        ['SBY', 'Cabang Surabaya', 'Kota Surabaya', 'Jawa Timur', 'Area Surabaya Pusat, Timur, Barat, Utara, Selatan', 'https://maps.google.com/?q=-7.265432,112.748901', -7.265432, 112.748901, 100, 'Bank BCA', '8735091234', 'PT Mitra Niaga Distribusi SBY', 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=QRIS_SBY', 'Aktif', new Date().toISOString()],
        ['SDA', 'Cabang Sidoarjo', 'Kabupaten Sidoarjo', 'Jawa Timur', 'Area Waru, Gedangan, Porong, Krian', 'https://maps.google.com/?q=-7.447890,112.718234', -7.447890, 112.718234, 100, 'Bank Mandiri', '1410098765432', 'PT Mitra Niaga Distribusi SDA', 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=QRIS_SDA', 'Aktif', new Date().toISOString()],
        ['MLG', 'Cabang Malang', 'Kota & Kab. Malang', 'Jawa Timur', 'Area Malang Raya, Batu, Singosari', 'https://maps.google.com/?q=-7.978120,112.621450', -7.978120, 112.621450, 100, 'Bank BRI', '002101987654321', 'PT Mitra Niaga Distribusi MLG', 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=QRIS_MLG', 'Aktif', new Date().toISOString()],
        ['LBR', 'Cabang Lombok Barat', 'Kabupaten Lombok Barat', 'Nusa Tenggara Barat', 'Area Gerung, Kediri, Narmada, Sekotong', 'https://maps.google.com/?q=-8.681234,116.123456', -8.681234, 116.123456, 100, 'Bank BCA', '2690877345', 'Novan Ardiansyah', 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=QRIS_LBR', 'Aktif', new Date().toISOString()],
        ['LOTENG', 'Cabang Lombok Tengah', 'Kabupaten Lombok Tengah', 'Nusa Tenggara Barat', 'Area Praya, Pujut, Kopang, Jonggat', 'https://maps.google.com/?q=-8.710000,116.270000', -8.710000, 116.270000, 100, 'Bank BCA', '2690877345', 'Novan Ardiansyah', 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=QRIS_LOTENG', 'Aktif', new Date().toISOString()],
        ['LTM', 'Cabang Lombok Timur', 'Kabupaten Lombok Timur', 'Nusa Tenggara Barat', 'Area Selong, Masbagik, Aikmel, Labuhan Haji', 'https://maps.google.com/?q=-8.650000,116.530000', -8.650000, 116.530000, 100, 'Bank BCA', '2690877345', 'Novan Ardiansyah', 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=QRIS_LTM', 'Aktif', new Date().toISOString()],
        ['KLU', 'Cabang Lombok Utara', 'Kabupaten Lombok Utara', 'Nusa Tenggara Barat', 'Area Tanjung, Gangga, Kayangan, Bayan', 'https://maps.google.com/?q=-8.350000,116.160000', -8.350000, 116.160000, 100, 'Bank BCA', '2690877345', 'Novan Ardiansyah', 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=QRIS_KLU', 'Aktif', new Date().toISOString()]
      ]
    },
    {
      sheetName: 'PRODUK',
      headers: ['Kode Produk', 'Nama Produk', 'Singkatan', 'Isi Per Bal', 'Kategori', 'Harga Jual', 'Satuan', 'Stok Awal', 'Target Bulanan', 'Status', 'Tanggal Dibuat'],
      seedData: [
        ['PSD', 'Ps Djeram (PSK)', 'PSK', 200, 'ROKOK', 18000, 'Bks', 500, 200, 'Aktif', new Date().toISOString()],
        ['PSF', 'Ps Filter (PSF)', 'PSF', 200, 'ROKOK', 19000, 'Bks', 400, 180, 'Aktif', new Date().toISOString()],
        ['AGE', 'AGE', 'AGE', 200, 'ROKOK', 20000, 'Bks', 600, 250, 'Aktif', new Date().toISOString()],
        ['ART', 'ARTI', 'ART', 200, 'ROKOK', 17500, 'Bks', 450, 190, 'Aktif', new Date().toISOString()],
        ['PSE', 'Ps Exclusive (PSE)', 'PSE', 100, 'ROKOK', 21000, 'Bks', 350, 150, 'Aktif', new Date().toISOString()],
        ['AAM', 'Arti Apel Madu', 'AAM', 100, 'ROKOK', 22000, 'Bks', 300, 120, 'Aktif', new Date().toISOString()],
        ['PSMI', 'Ps Mild', 'MILD', 100, 'ROKOK', 18500, 'Bks', 400, 160, 'Aktif', new Date().toISOString()],
        ['PSMGO', 'Ps Mangga', 'MANGGA', 100, 'ROKOK', 19500, 'Bks', 500, 200, 'Aktif', new Date().toISOString()],
        ['PSPLR', 'Ps Purple', 'PURPLE', 100, 'ROKOK', 19500, 'Bks', 350, 140, 'Aktif', new Date().toISOString()],
        ['PSWTM', 'Ps Watermelon', 'WT MELON', 100, 'ROKOK', 19500, 'Bks', 350, 140, 'Aktif', new Date().toISOString()],
        ['PSAPL', 'Ps Apel', 'APEL', 100, 'ROKOK', 19500, 'Bks', 350, 140, 'Aktif', new Date().toISOString()],
        ['KJJ', 'Kopi Josjis', 'KOPI JOSJIS', 200, 'ROKOK', 17000, 'Bks', 400, 170, 'Aktif', new Date().toISOString()]
      ]
    },
    {
      sheetName: 'OUTLET',
      headers: ['Kode Outlet', 'Nama Toko', 'Nama Pemilik', 'Nomor HP', 'Alamat', 'Kode Wilayah', 'Hari Kunjungan', 'Link Google Maps', 'Latitude', 'Longitude', 'Radius Meter', 'Bisa Untuk Absensi', 'Status Verifikasi', 'Didaftarkan Oleh', 'Diverifikasi Oleh', 'Tanggal Dibuat'],
      seedData: [
        ['OTL-001', 'Toko Berkah Jaya', 'H. Mahmud', '081298765432', 'Jl. Raya Darmo No. 12, Wonokromo, Surabaya', 'SBY', 'Kamis', 'https://maps.google.com/?q=-7.289123,112.738456', -7.289123, 112.738456, 50, 'Ya', 'Verified', 'USR-003', 'USR-002', new Date().toISOString()],
        ['OTL-002', 'Toko Sumber Rejeki', 'Ibu Nurul', '081387654321', 'Jl. Pahlawan No. 88, Sidoarjo', 'SDA', 'Kamis', 'https://maps.google.com/?q=-7.447890,112.718234', -7.447890, 112.718234, 50, 'Ya', 'Verified', 'USR-004', 'USR-002', new Date().toISOString()],
        ['OTL-003', 'Toko Maju Bersama', 'Pak Agus', '081765432109', 'Jl. Ijen No. 25, Klojen, Malang', 'MLG', 'Jumat', 'https://maps.google.com/?q=-7.978120,112.621450', -7.978120, 112.621450, 60, 'Tidak', 'Verified', 'USR-005', 'USR-002', new Date().toISOString()],
        ['OTL-004', 'Toko Barokah Sejahtera', 'Hj. Aminah', '081876543210', 'Jl. Rungkut Madya No. 50, Surabaya', 'SBY', 'Senin', 'https://maps.google.com/?q=-7.321456,112.782341', -7.321456, 112.782341, 50, 'Tidak', 'Verified', 'USR-003', 'USR-002', new Date().toISOString()],
        ['OTL-005', 'Toko Sembako Abadi', 'Ko Handoko', '081987654321', 'Jl. Gajah Mada No. 102, Sidoarjo', 'SDA', 'Setiap Hari', 'https://maps.google.com/?q=-7.452341,112.714567', -7.452341, 112.714567, 50, 'Tidak', 'Pending', 'USR-004', '-', new Date().toISOString()]
      ]
    },
    {
      sheetName: 'ABSENSI',
      headers: ['ID Absensi', 'ID Sales', 'Tanggal', 'Jam Masuk', 'Jam Pulang', 'Latitude Masuk', 'Longitude Masuk', 'Latitude Pulang', 'Longitude Pulang', 'Jarak Masuk Meter', 'Jarak Pulang Meter', 'Status Lokasi', 'Foto Selfie Masuk', 'Foto Selfie Pulang'],
      seedData: []
    },
    {
      sheetName: 'KUNJUNGAN',
      headers: ['ID Kunjungan', 'ID Sales', 'Kode Outlet', 'Tanggal', 'Jam Kunjungan', 'Latitude', 'Longitude', 'Jarak Meter', 'Status Validasi', 'Foto Selfie', 'Foto Barang', 'Foto Display', 'Catatan Kunjungan', 'Stok Toko', 'Tanggal Dibuat'],
      seedData: []
    },
    {
      sheetName: 'TRANSAKSI',
      headers: ['Nomor Faktur', 'Waktu Transaksi', 'ID Sales', 'Kode Outlet', 'Kode Wilayah', 'Total Item', 'Subtotal', 'Diskon', 'Total Akhir', 'Metode Pembayaran', 'Status Pembayaran', 'Catatan', 'Tanggal Dibuat'],
      seedData: []
    },
    {
      sheetName: 'TRANSAKSI DETAIL',
      headers: ['ID Detail', 'Nomor Faktur', 'Kode Produk', 'Nama Produk', 'Harga Satuan', 'Qty', 'Satuan', 'Subtotal'],
      seedData: []
    },
    {
      sheetName: 'STOK_SALES',
      headers: ['ID Permintaan', 'Tanggal', 'ID Sales', 'Kode Produk', 'Nama Produk', 'Satuan', 'Qty Diminta', 'Qty Disetujui', 'Qty Terjual', 'Qty Retur', 'Sisa Stok Sales', 'Status', 'Catatan', 'Disetujui Oleh', 'Waktu Request', 'Waktu Closing'],
      seedData: []
    }
  ];

  // 3. Eksekusi Safe Migration untuk setiap sheet
  schema.forEach(item => {
    safeMigrateSheet(ss, item);
  });

  // 4. Auto-Repair nilai kolom Outlet
  autoRepairOutletData(ss);

  // Hapus Sheet1 default kosong jika masih ada dan ada sheet lain
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    try {
      if (defaultSheet.getLastRow() === 0) {
        ss.deleteSheet(defaultSheet);
      }
    } catch (e) {
      // Ignore
    }
  }

  Logger.log('✅ Safe Migration & Setup Database Selesai! Seluruh data lama tersimpan aman.');
  return {
    success: true,
    message: 'Safe Migration Berhasil! Seluruh data tersimpan aman dan skema pembayaran terupdate.',
    folders: driveFolders
  };
}

// Alias: runSafeMigration (Bisa dipilih langsung di dropdown Apps Script)
function runSafeMigration() {
  return setupDatabase();
}

/**
 * Fungsi Safe Migration Non-Destructive per Sheet
 */
function safeMigrateSheet(ss, schemaItem) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!schemaItem) return setupDatabase();

  let sheet = ss.getSheetByName(schemaItem.sheetName);

  // KASUS 1: Sheet Belum Ada Sama Sekali -> Buat Baru & Pasang Seed Data
  if (!sheet) {
    sheet = ss.insertSheet(schemaItem.sheetName);
    sheet.getRange(1, 1, 1, schemaItem.headers.length).setValues([schemaItem.headers]);
    formatHeaderRow(sheet, schemaItem.headers.length);

    if (schemaItem.seedData && schemaItem.seedData.length > 0) {
      sheet.getRange(2, 1, schemaItem.seedData.length, schemaItem.headers.length).setValues(schemaItem.seedData);
    }
    return;
  }

  // KASUS 2: Sheet Sudah Ada -> Mencegah Data Hilang & Melakukan Migrasi Kolom/Baris
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow === 0 || lastCol === 0) {
    sheet.getRange(1, 1, 1, schemaItem.headers.length).setValues([schemaItem.headers]);
    formatHeaderRow(sheet, schemaItem.headers.length);
    if (schemaItem.seedData && schemaItem.seedData.length > 0) {
      sheet.getRange(2, 1, schemaItem.seedData.length, schemaItem.headers.length).setValues(schemaItem.seedData);
    }
    return;
  }

  // 2A. Baca Header yang sudah ada di Row 1
  const existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const existingHeaderSet = new Set(existingHeaders.map(h => String(h).trim()));

  // 2B. Cek apakah ada kolom baru di skema yang belum ada di spreadsheet
  let currentMaxCol = lastCol;
  schemaItem.headers.forEach(targetHeader => {
    if (!existingHeaderSet.has(String(targetHeader).trim())) {
      currentMaxCol++;
      sheet.getRange(1, currentMaxCol).setValue(targetHeader);
      Logger.log(`[Safe Migrate] Menambahkan kolom baru: "${targetHeader}" pada sheet ${schemaItem.sheetName}`);
    }
  });

  // Re-format styling header row 1 tanpa mengubah baris data
  formatHeaderRow(sheet, currentMaxCol);

  // 2C. Penanganan Khusus Sheet CONFIG (Menambahkan key pembayaran baru jika belum ada)
  if (schemaItem.sheetName === 'CONFIG' && schemaItem.seedData) {
    const existingConfigData = sheet.getRange(2, 1, Math.max(1, lastRow - 1), 1).getValues();
    const existingKeySet = new Set(existingConfigData.map(r => String(r[0]).trim()));

    schemaItem.seedData.forEach(seedRow => {
      const key = String(seedRow[0]).trim();
      if (!existingKeySet.has(key)) {
        sheet.appendRow(seedRow);
        Logger.log(`[Safe Migrate] Menambahkan config key baru: "${key}" pada sheet CONFIG`);
      }
    });
  }
}

/**
 * Auto-Repair untuk memperbaiki data Outlet yang sebelumnya sempat bergeser nilai kolomnya
 */
function autoRepairOutletData(ss) {
  const sheet = ss.getSheetByName('OUTLET');
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol <= 1) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const headerMap = {};
  headers.forEach((h, idx) => { headerMap[h] = idx + 1; });

  const latCol = headerMap['Latitude'];
  const lngCol = headerMap['Longitude'];
  const radCol = headerMap['Radius Meter'];
  const absenCol = headerMap['Bisa Untuk Absensi'];

  if (!latCol || !lngCol || !radCol) return;

  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  rows.forEach((row, idx) => {
    const r = idx + 2;
    let latVal = row[latCol - 1];
    let lngVal = row[lngCol - 1];
    let radVal = row[radCol - 1];

    if (typeof radVal === 'number' && (radVal < 0 || radVal > 1000)) {
      if (radVal > 100) {
        sheet.getRange(r, lngCol).setValue(radVal);
        sheet.getRange(r, radCol).setValue(50);
      } else if (radVal < 0) {
        sheet.getRange(r, latCol).setValue(radVal);
        sheet.getRange(r, radCol).setValue(50);
      }
    }

    if (typeof latVal === 'number' && latVal > 100) {
      sheet.getRange(r, lngCol).setValue(latVal);
      sheet.getRange(r, latCol).setValue(-7.289123);
    }

    if (typeof lngVal === 'number' && lngVal < 0) {
      sheet.getRange(r, latCol).setValue(lngVal);
      sheet.getRange(r, lngCol).setValue(112.738456);
    }

    if (!radVal || isNaN(Number(radVal)) || Number(radVal) <= 0 || Number(radVal) > 1000) {
      sheet.getRange(r, radCol).setValue(50);
    }

    if (absenCol && (!row[absenCol - 1] || row[absenCol - 1] === '')) {
      sheet.getRange(r, absenCol).setValue('Ya');
    }
  });
}

/**
 * Format Styling Baris Header (Row 1)
 */
function formatHeaderRow(sheet, numColumns) {
  if (numColumns <= 0) return;
  const headerRange = sheet.getRange(1, 1, 1, numColumns);
  headerRange.setBackground('#0B132B')
             .setFontColor('#FFFFFF')
             .setFontWeight('bold')
             .setFontFamily('Arial')
             .setFontSize(10)
             .setHorizontalAlignment('center')
             .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 32);
  sheet.setFrozenRows(1);

  for (let c = 1; c <= numColumns; c++) {
    sheet.autoResizeColumn(c);
    if (sheet.getColumnWidth(c) < 130) {
      sheet.setColumnWidth(c, 140);
    }
  }
}

/**
 * Membuat folder penampungan foto di Google Drive jika belum ada (Non-Destructive)
 */
function createOrGetDriveFolderStructure() {
  const rootFolderName = 'WebApp_Monitoring_Sales_Uploads';
  let rootFolder;
  
  const rootIterator = DriveApp.getFoldersByName(rootFolderName);
  if (rootIterator.hasNext()) {
    rootFolder = rootIterator.next();
  } else {
    rootFolder = DriveApp.createFolder(rootFolderName);
    rootFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }

  function getOrCreateSubfolder(parent, name) {
    const it = parent.getFoldersByName(name);
    if (it.hasNext()) {
      return it.next();
    } else {
      const sub = parent.createFolder(name);
      sub.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return sub;
    }
  }

  const absensiFolder = getOrCreateSubfolder(rootFolder, 'Foto_Absensi');
  const kunjunganFolder = getOrCreateSubfolder(rootFolder, 'Foto_Kunjungan_Selfie');
  const displayFolder = getOrCreateSubfolder(rootFolder, 'Foto_Display_Dan_Barang');

  return {
    rootFolderId: rootFolder.getId(),
    absensiFolderId: absensiFolder.getId(),
    kunjunganFolderId: kunjunganFolder.getId(),
    displayFolderId: displayFolder.getId()
  };
}
