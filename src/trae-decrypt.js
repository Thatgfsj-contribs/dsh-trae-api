/**
 * trae-decrypt.js - Trae "tc" 加密格式解密
 *
 * 支持版本: Trae CN / TRAE SOLO CN / TRAE SOLO(国际版) 均使用 tc 加密
 *          Trae SG(国际版) 直接存储明文 JSON,decryptAuthData 中自动识别
 *
 * Data structure: [6B Header][32B RandomBytes][N EncryptedData]
 * Decrypted:      [64B SHA-512 Hash][N Plaintext JSON]
 *
 * Key derivation: SHA-512(RandomBytes) -> +XOR-Salt -> SHA-512 -> Key(16B) + IV(16B)
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 4 hardcoded salt arrays from Trae CN's frontend JS (64 bytes each)
const SALT_A = Uint8Array.from([
  82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,
  124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,
  84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,
  8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37
]);

const SALT_B = Uint8Array.from([
  31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,
  96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,
  160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,
  23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125
]);

const SALT_C = Uint8Array.from([
  191,192,216,250,122,246,220,97,31,254,98,27,8,72,71,176,
  135,99,96,18,127,101,203,104,211,102,191,125,37,72,150,156,
  51,229,121,35,17,153,141,177,110,131,150,128,172,255,254,6,
  18,140,55,62,236,249,135,64,135,12,117,4,89,149,168,209
]);

const SALT_D = Uint8Array.from([
  246,204,26,232,232,70,129,109,223,146,169,242,23,241,105,145,
  50,196,165,42,254,120,3,54,244,207,209,85,53,6,138,106,
  175,148,31,204,186,186,165,182,87,142,49,10,39,110,26,154,
  86,56,173,125,18,64,198,225,99,99,83,82,191,134,76,170
]);

function xorSalts(a, b, len) {
  const result = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

function detectEncType(header) {
  if (header[0] === 0x74 && header[1] === 0x63 &&
      header[2] === 0x05 && header[3] === 0x10 &&
      header[4] === 0x00 && header[5] === 0x00) {
    return 'AES';
  }
  if (header[0] === 18 && header[1] === 57 &&
      header[2] === 32 && header[3] === 32 &&
      header[4] === 2 && header[5] === 3) {
    return 'AES_PRIVATE';
  }
  return 'UNKNOWN';
}

function deriveKeyAndIV(randomBytes, encType) {
  let salt;
  if (encType === 'AES_PRIVATE') {
    salt = xorSalts(SALT_C, SALT_D, 64);
  } else {
    salt = xorSalts(SALT_A, SALT_B, 64);
  }

  const hashOfRandom = crypto.createHash('sha512')
    .update(Buffer.from(randomBytes))
    .digest();

  const combined = Buffer.concat([hashOfRandom, Buffer.from(salt)]);
  const finalHash = crypto.createHash('sha512')
    .update(combined)
    .digest();

  const aesKey = finalHash.slice(0, 16);
  const iv = finalHash.slice(16, 32);

  return { aesKey, iv };
}

function aesCbcDecrypt(key, iv, data) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let decrypted = decipher.update(data);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted;
}

function decryptStorageValue(base64Value) {
  const buffer = Buffer.from(base64Value, 'base64');

  const header = buffer.slice(0, 6);
  const randomBytes = buffer.slice(6, 38);
  const encryptedData = buffer.slice(38);

  const encType = detectEncType(header);
  if (encType === 'UNKNOWN') {
    throw new Error('Unknown encryption type');
  }

  const { aesKey, iv } = deriveKeyAndIV(randomBytes, encType);
  const decrypted = aesCbcDecrypt(aesKey, iv, encryptedData);

  const storedHash = decrypted.slice(0, 64);
  const plaintext = decrypted.slice(64);
  const computedHash = crypto.createHash('sha512').update(plaintext).digest();

  if (!storedHash.equals(computedHash)) {
    throw new Error('Hash verification failed - decryption may be incorrect');
  }

  return plaintext.toString('utf8');
}

// Electron `userData` folder name per Trae edition (same on every platform).
const EDITION_PRODUCT_NAMES = {
  cn: 'Trae CN',
  solo: 'TRAE SOLO CN',
  sg: 'Trae',
  'solo-sg': 'TRAE SOLO',
};

const AUTH_STORAGE_KEY = 'iCubeAuthInfo://icube.cloudide';

/**
 * Normalize any of these into the `<userData>/User` directory:
 *   <userData>            e.g. ~/.config/Trae CN
 *   <userData>/User       e.g. ~/.config/Trae CN/User
 */
function toUserDir(dir) {
  const resolved = path.resolve(dir);
  return path.basename(resolved) === 'User' ? resolved : path.join(resolved, 'User');
}

/**
 * Directories that may contain an Electron `userData` folder on this platform.
 *
 * Trae is an Electron/VS Code based IDE, so its user data lives in the
 * per-platform application-data location:
 *
 *   Windows : %APPDATA%                          -> C:\Users\<u>\AppData\Roaming
 *   macOS   : ~/Library/Application Support
 *   Linux   : $XDG_CONFIG_HOME or ~/.config      (plus ~/.local/share as fallback)
 */
function platformConfigRoots() {
  const roots = [];
  if (process.platform === 'win32') {
    roots.push(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'));
  } else if (process.platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library', 'Application Support'));
  } else {
    roots.push(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
    roots.push(path.join(os.homedir(), '.local', 'share'));
  }
  return roots.filter(Boolean);
}

function hasStorageJson(userDir) {
  return fs.existsSync(path.join(userDir, 'globalStorage', 'storage.json'));
}

/**
 * Candidate `<userData>/User` directories for an edition, most specific first.
 * `TRAE_DATA_DIR` (app userData dir or the `User` dir itself) wins if set.
 */
function listCandidateUserDirs(edition) {
  const productName = EDITION_PRODUCT_NAMES[edition] || EDITION_PRODUCT_NAMES.cn;
  const dirs = [];
  if (process.env.TRAE_DATA_DIR) dirs.push(toUserDir(process.env.TRAE_DATA_DIR));
  for (const root of platformConfigRoots()) {
    dirs.push(path.join(root, productName, 'User'));
  }
  return [...new Set(dirs)];
}

/**
 * Last-resort discovery: scan the platform config roots for any directory that
 * actually holds a Trae storage.json. Covers renamed/repackaged builds whose
 * folder name does not match the product name we expect.
 */
function scanForUserDir() {
  for (const root of platformConfigRoots()) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const userDir = path.join(root, entry.name, 'User');
      if (hasStorageJson(userDir)) return userDir;
    }
  }
  return null;
}

/**
 * Resolve the existing `<userData>/User` directory for an edition. Falls back to
 * the platform default (even if missing) so error messages stay actionable.
 */
function resolveUserDir(edition) {
  const candidates = listCandidateUserDirs(edition);
  const existing = candidates.find(hasStorageJson);
  if (existing) return existing;
  return scanForUserDir() || candidates[0];
}

function decryptAuthData(dataDir) {
  const userDir = toUserDir(dataDir);
  const storagePath = path.join(userDir, 'globalStorage', 'storage.json');

  if (!fs.existsSync(storagePath)) {
    throw new Error(`storage.json not found at: ${storagePath}`);
  }

  const storage = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  // Prefer the well-known key, but tolerate renamed ones across Trae versions.
  const otherKeys = Object.keys(storage).filter(
    (k) => k !== AUTH_STORAGE_KEY && k.startsWith('iCubeAuthInfo://') && typeof storage[k] === 'string' && storage[k].trim()
  );

  let lastError = null;
  for (const key of [AUTH_STORAGE_KEY, ...otherKeys]) {
    const value = storage[key];
    if (typeof value !== 'string' || !value.trim()) continue;

    try {
      if (value.trim().startsWith('{')) {
        console.log('[decrypt] Auth data is plaintext (SG edition)');
        return JSON.parse(value);
      }

      console.log(`[decrypt] Decrypting tc format from key: ${key}`);
      return JSON.parse(decryptStorageValue(value));
    } catch (err) {
      lastError = err;
    }
  }

  if (!storage[AUTH_STORAGE_KEY]) {
    throw new Error(`${AUTH_STORAGE_KEY} key not found in storage.json`);
  }
  throw lastError || new Error(`Failed to decrypt auth data from ${storagePath}`);
}

function getTraeCNDataDir() {
  return resolveUserDir('cn');
}

function getTraeSGDataDir() {
  return resolveUserDir('sg');
}

function getTraeSoloCNDataDir() {
  return resolveUserDir('solo');
}

function getTraeSoloSGDataDir() {
  return resolveUserDir('solo-sg');
}

module.exports = {
  decryptStorageValue,
  decryptAuthData,
  getTraeCNDataDir,
  getTraeSGDataDir,
  getTraeSoloCNDataDir,
  getTraeSoloSGDataDir,
  resolveUserDir,
  listCandidateUserDirs,
  platformConfigRoots,
  EDITION_PRODUCT_NAMES,
};