const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

const ROOT_DIR = path.resolve(__dirname, '../../');
const SESSIONS_DIR = path.join(ROOT_DIR, 'sessions');
const IMAGES_DIR = path.join(SESSIONS_DIR, 'generated_images');
const METADATA_FILE = path.join(IMAGES_DIR, 'metadata.json');

const STORAGE_IMAGES_DIR = path.join(ROOT_DIR, 'storage/images');
const STORAGE_METADATA_FILE = path.join(STORAGE_IMAGES_DIR, 'metadata.json');

// Pastikan direktori penampungan gambar selalu tersedia
function ensureDirectory() {
  [IMAGES_DIR, STORAGE_IMAGES_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  [METADATA_FILE, STORAGE_METADATA_FILE].forEach((file) => {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify([], null, 2), 'utf-8');
    }
  });
}

/**
 * Membaca daftar riwayat berkas hasil generate yang masih valid di disk
 */
function getGeneratedImagesList() {
  ensureDirectory();
  try {
    const list = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
    if (!Array.isArray(list)) return [];
    // Hanya tampilkan jika berkas fisiknya ada di harddisk
    return list.filter((item) => item?.filePath && fs.existsSync(item.filePath));
  } catch (err) {
    return [];
  }
}

/**
 * Menyimpan gambar baru ke penampungan lokal
 */
function saveGeneratedImage({ base64Data, prompt, aspectRatio = '1:1' }) {
  ensureDirectory();

  const id = Date.now().toString();
  const fileName = `img_${id}.png`;
  const filePath = path.join(IMAGES_DIR, fileName);
  const storageFilePath = path.join(STORAGE_IMAGES_DIR, fileName);

  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  
  fs.writeFileSync(filePath, buffer);
  try {
    fs.writeFileSync(storageFilePath, buffer);
  } catch (e) {}

  const list = getGeneratedImagesList();
  const newItem = {
    id,
    fileName,
    filePath,
    storagePath: storageFilePath,
    prompt: prompt || 'Tanpa prompt deskripsi',
    aspectRatio,
    createdAt: new Date().toISOString()
  };

  list.unshift(newItem);
  fs.writeFileSync(METADATA_FILE, JSON.stringify(list, null, 2), 'utf-8');

  try {
    let storageList = [];
    if (fs.existsSync(STORAGE_METADATA_FILE)) {
      storageList = JSON.parse(fs.readFileSync(STORAGE_METADATA_FILE, 'utf-8')) || [];
    }
    storageList.unshift(newItem);
    fs.writeFileSync(STORAGE_METADATA_FILE, JSON.stringify(storageList, null, 2), 'utf-8');
  } catch (e) {}

  return {
    success: true,
    item: newItem
  };
}

/**
 * Menghapus berkas gambar dari disk dan membersihkan metadata secara menyeluruh
 * Menerima id (number/string), filePath, atau fileName
 */
function deleteGeneratedImage(identifier, fallbackPath) {
  ensureDirectory();

  const targetId = identifier ? String(identifier).trim() : '';
  const targetPath = fallbackPath ? String(fallbackPath).trim() : (targetId.includes('/') || targetId.includes('\\') ? targetId : '');

  const metaFiles = [METADATA_FILE, STORAGE_METADATA_FILE];
  const filesToDelete = new Set();

  if (targetPath) {
    filesToDelete.add(path.resolve(targetPath.replace('file:///', '')));
  }

  metaFiles.forEach((metaFile) => {
    if (!fs.existsSync(metaFile)) return;
    try {
      let list = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      if (Array.isArray(list)) {
        const filtered = list.filter((item) => {
          const itemId = item.id ? String(item.id).trim() : '';
          const itemPath = item.filePath || item.storagePath || '';
          const itemFile = item.fileName || path.basename(itemPath);

          const isMatch =
            (targetId && (itemId === targetId || itemFile === targetId)) ||
            (targetPath && (
              itemPath === targetPath ||
              path.resolve(itemPath) === path.resolve(targetPath) ||
              itemFile === path.basename(targetPath)
            ));

          if (isMatch) {
            if (item.filePath) filesToDelete.add(path.resolve(item.filePath));
            if (item.storagePath) filesToDelete.add(path.resolve(item.storagePath));
            return false;
          }
          return true;
        });

        fs.writeFileSync(metaFile, JSON.stringify(filtered, null, 2), 'utf-8');
      }
    } catch (err) {}
  });

  // Hapus berkas fisik
  filesToDelete.forEach((fPath) => {
    try {
      if (fs.existsSync(fPath)) {
        fs.unlinkSync(fPath);
      }
    } catch (e) {}
  });

  return { success: true };
}

/**
 * Membuka folder penampungan di Windows File Explorer
 */
function openImagesFolder() {
  ensureDirectory();
  shell.openPath(IMAGES_DIR);
  return { success: true, path: IMAGES_DIR };
}

module.exports = {
  getGeneratedImagesList,
  saveGeneratedImage,
  deleteGeneratedImage,
  openImagesFolder,
  IMAGES_DIR
};