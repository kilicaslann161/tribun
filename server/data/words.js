/**
 * Tribün — küfür/spam filtresi kelime listesi yükleyici
 * Kelimeler server/data/blocklist.txt dosyasından okunur (kolay genişletilebilir).
 * Dosya yoksa / boşsa filtre pas geçer (yerel geliştirme dostu).
 */
const fs = require('fs');
const path = require('path');

const BLOCKLIST_FILE = path.join(__dirname, 'blocklist.txt');

function normalizeWord(w) {
  return String(w)
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .trim();
}

function loadBlocklist() {
  try {
    return fs.readFileSync(BLOCKLIST_FILE, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map(normalizeWord)
      .filter(Boolean);
  } catch {
    return [];
  }
}

const BAD_WORDS = [...new Set(loadBlocklist())];

module.exports = { BAD_WORDS, BLOCKLIST_FILE };
