/**
 * Tribün — CLI migration çalıştırıcı: `npm run db:migrate`
 * Uygulanan migration sayısını döner; uygulanacak yoksa "Uygulanacak migration yok." der.
 */
const { migrate } = require('./index');

try {
  migrate({ log: true }); // "Uygulanacak migration yok." mesajını da migrate içinde basılır
  process.exit(0);
} catch (e) {
  console.error(`Migration hatası: ${e.message}`);
  process.exit(1);
}
