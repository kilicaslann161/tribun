/**
 * Tribün — Express sunucu giriş noktası
 * API /api altında, frontend ise public/ klasöründen statik sunulur.
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

require('./db'); // tabloları oluşturur (ilk çalıştırmada)

// Spor veri tabloları: migration'lar route'lardan ÖNCE, idempotent biçimde uygulanır
const { migrate } = require('./migrations');
migrate();

const { generalLimiter, gameLimiter, sportsLimiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');        // /api/auth/*, /api/me
const scoreRoutes = require('./routes/scores');     // /api/leaderboard
const badgeRoutes = require('./routes/badges');     // /api/badges
const gameRoutes = require('./routes/games');       // /api/games/* (penalty, oracle, quiz)
const dictionaryRoutes = require('./routes/dictionary'); // /api/dictionary*
const memoryRoutes = require('./routes/memories');  // /api/memories*
const reportRoutes = require('./routes/report');    // /api/report
const bingoRoutes = require('./routes/bingo');      // /api/bingo/*
const transferRoutes = require('./routes/transfer'); // /api/transfer/*
const adminRoutes = require('./routes/admin');      // /api/admin/*
const matchesRoutes = require('./routes/matches');  // /api/matches (SportScore widget)
const sportsRoutes = require('./routes/sports');    // /api/sports/* (Aşama 4 okuma API'si; SportScore'a istek ATMaz)

const app = express();
app.disable('x-powered-by');
// Reverse proxy (preview ingress / Caddy) arkasında çalışıyoruz:
// X-Forwarded-For'a güven → express-rate-limit gerçek istemci IP'sini görsün.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use('/api', generalLimiter);

app.use('/api', authRoutes); // authLimiter yalnızca login/register üzerinde (routes/auth.js içinde)
app.use('/api', scoreRoutes);
app.use('/api', badgeRoutes);
app.use('/api', dictionaryRoutes);
app.use('/api', memoryRoutes);
app.use('/api', reportRoutes);
app.use('/api/games', gameLimiter, gameRoutes);
app.use('/api/bingo', gameLimiter, bingoRoutes); // mark ucunda 60/dk limit (polling dahil)
app.use('/api/transfer', gameLimiter, transferRoutes);
app.use('/api', matchesRoutes); // GET /api/matches — önbellekli widget kaynağı
app.use('/api/sports', sportsLimiter, sportsRoutes); // Aşama 4: yalnız SQLite okuma, 120/dk
app.use('/api/admin', adminRoutes);

// Frontend (düz HTML/CSS/JS)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Bilinmeyen API yolları için JSON 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Böyle bir uç nokta yok. Rotayı kontrol et.' }));

// Genel hata yakalayıcı
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Geçersiz istek gövdesi (JSON bozuk).' });
  }
  console.error('[hata]', err);
  res.status(500).json({ error: 'Sunucuda bir şeyler ters gitti. Birazdan tekrar dene.' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`⚽ Tribün ayakta!  http://localhost:${PORT}`);
  console.log(`   Admin paneli:    http://localhost:${PORT}/admin.html`);

  // Aşama 3: spor senkronu (yalnızca açıkken; kütüphanesiz setTimeout zinciri)
  // Aşama 5: canlı skor işi — aynı anahtarla açılır, düzgün kapanır.
  if (String(process.env.SPORTS_SYNC_ENABLED).toLowerCase() === 'true') {
    const { startScheduler, stopScheduler } = require('./jobs/scheduler');
    const { startLiveScoresJob, stopLiveScoresJob } = require('./jobs/liveScoresJob');
    const { startStandingsJob, stopStandingsJob } = require('./jobs/standingsJob');
    const { startForecastJob, stopForecastJob } = require('./jobs/forecastJob');
    startScheduler();
    startLiveScoresJob();
    startStandingsJob();
    startForecastJob();
    const shutdown = () => {
      stopScheduler();
      stopLiveScoresJob();
      stopStandingsJob();
      stopForecastJob();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
});
