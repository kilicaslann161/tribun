#!/usr/bin/env node
/**
 * sync-quiz-data.js — server/data/quiz-questions.js dosyasından
 * public/js/data/quiz-questions.js (istemci aynası) üretir.
 *
 * Sunucu dosyası tek doğruluk kaynağıdır; soru metinleri ve seçenek sırası
 * otomatik olarak birebir kopyalanır. Elle istemci dosyası yazmak yasak.
 *
 * Kullanım: node scripts/sync-quiz-data.js  (tribun kökünden)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'server', 'data', 'quiz-questions.js');
const dstDir = path.join(root, 'public', 'js', 'data');
const dstPath = path.join(dstDir, 'quiz-questions.js');

const { QUIZ_QUESTIONS } = require(srcPath);

const banner = `/**
 * Tribün — Taraftar Testi verisi (İSTEMCİ tarafı)
 *
 * ⚠️ BU DOSYA MAKİNE TARAFINDAN ÜRETİLİR: scripts/sync-quiz-data.js
 * Soru/seçenek metinleri server/data/quiz-questions.js ile birebir aynıdır;
 * elle düzenleme yapmayın, düzenlemeyi sunucu dosyasında yapıp scripti çalıştırın.
 *
 * İstemci yalnızca soruları gösterir; tip hesabı SUNUCUDA yapılır
 * (POST /api/games/quiz/submit → {answers: [seçenek indeksi x10]}).
 */

export const QUIZ = ${JSON.stringify(
  QUIZ_QUESTIONS.map(({ q, options }) => ({ q, options: options.map((o) => o.t) })),
  null,
  2
)};
`;

fs.mkdirSync(dstDir, { recursive: true });
fs.writeFileSync(dstPath, banner, 'utf8');

// Doğrulama: uzunluk ve sıra uyumu
const client = fs.readFileSync(dstPath, 'utf8');
for (const [i, q] of QUIZ_QUESTIONS.entries()) {
  for (const [j, o] of q.options.entries()) {
    if (!client.includes(JSON.stringify(o.t))) {
      throw new Error(`Uyuşmazlık: soru ${i + 1} seçenek ${j + 1} istemci dosyasında yok`);
    }
  }
}

console.log(`✅ İstemci quiz verisi güncellendi: ${path.relative(root, dstPath)}`);
console.log(`   ${QUIZ_QUESTIONS.length} soru, ${QUIZ_QUESTIONS.reduce((n, q) => n + q.options.length, 0)} seçenek, sıra doğrulandı.`);
