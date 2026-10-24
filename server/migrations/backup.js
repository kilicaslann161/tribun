/**
 * Tribün — veritabanı yedekleme
 * WAL modunda düz dosya kopyalamak tutarsız yedek üretir; bunun yerine
 * SQLite'ın kendi anlık görüntü mekanizması olan VACUUM INTO kullanılır.
 * Çıktı: data/backups/tribun-YYYYMMDD-HHMMSS.db
 *
 * Kullanım:
 *   - require: backupDb() → dosya yolu döner
 *   - CLI:     npm run db:backup  (veya: node server/migrations/backup.js)
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');

function backupDb() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '-');
  // Aynı saniyede birden fazla yedek (ör. art arda migration'lar) çakışmasın:
  // dosya adı mevcutsa -1, -2, ... sonekiyle benzersizleştir.
  let file = path.join(BACKUP_DIR, `tribun-${stamp}.db`);
  for (let i = 1; fs.existsSync(file); i++) {
    file = path.join(BACKUP_DIR, `tribun-${stamp}-${i}.db`);
  }
  db.prepare(`VACUUM INTO '${file.replace(/'/g, "''")}'`).run();
  return file;
}

module.exports = { backupDb, BACKUP_DIR };

/* CLI modu: doğrudan çalıştırıldığında */
if (require.main === module) {
  try {
    const f = backupDb();
    console.log(`🛡️  Yedek alındı: ${path.relative(process.cwd(), f)}`);
  } catch (e) {
    console.error(`Yedek alınamadı: ${e.message}`);
    process.exit(1);
  }
}
