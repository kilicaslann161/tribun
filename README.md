# 🏟️ Tribün — Futbol Mini Oyun Merkezi

Yerel bilgisayarında çalışan, Türkçe arayüzlü, mobil öncelikli futbol mini oyun salonu.
Gerçek kulüp/oyuncu ismi yok; her şey kurgu, espriler gerçek. 😄

## ✨ Neler Var?

- **Hesap sistemi**: takma ad + şifre (e-posta yok), JWT oturum, günlük giriş serisi (streak)
- **Puan & rozet sistemi**: sunucu tarafında doğrulanan puanlar, günlük oyun limitleri, otomatik rozetler
- **Liderlik tablosu**: genel ve oyun bazlı ilk 20
- **Taraftar Sözlüğü & Anı Defteri**: topluluk içerikleri, oylama, bildirme, otomatik gizleme
- **Maç Günü Bingo**: 6 haneli kodla oda kur/katıl, 3 saniyelik yenileme
- **Hayali Transfer**: 100 milyon bütçeyle kadro kur (bütçe kontrolü sunucuda)
- **Admin paneli**: `/admin.html` — istatistikler, son kayıtlar, rapor yönetimi

## 🔧 Gereksinimler

- Node.js 18+ (24 ile test edildi)
- npm

## 🚀 Kurulum

```bash
# 1) Bağımlılıklar
npm install

# 2) Ortam dosyası (zorunlu değil, örneği hazır)
copy .env.example .env      # Windows
cp .env.example .env        # Linux/Mac
# .env içindeki JWT_SECRET ve ADMIN_KEY değerlerini değiştirmen önerilir.

# 3) Örnek veri (isteğe bağlı ama önerilir)
npm run seed
```

Sunucu ilk açılışta `data/tribun.db` dosyasını ve tüm tabloları otomatik oluşturur.

## ▶️ Çalıştırma

```bash
npm run dev     # geliştirme modu (nodemon, değişiklikte yeniden başlar)
npm start       # düz üretim modu
```

- Site: <http://localhost:3000>
- Admin paneli: <http://localhost:3000/admin.html> (`.env` içindeki `ADMIN_KEY` ile girilir)

## 🌱 Seed ve Sıfırlama

```bash
npm run seed              # veritabanı boşsa örnek veri basar
npm run seed -- --force   # mevcut veriyi silip yeniden basar
npm run db:reset          # veritabanı dosyasını tamamen siler
```

Seed örnek bingo odaları: `ORNEK1` (açık, 3 oyuncu) ve `FINSH1` (bitmiş, kazanan: DerbiKahini);
3 örnek transfer kadrosu (TribunKurdu, DerbiKahini, KaleciBaba) dahildir.

> `db:reset` yapmadan önce sunucuyu durdur (Ctrl+C), yoksa dosya kilitli kalabilir.

### Örnek Kullanıcılar (şifre: `sifre123`)

| Takma Ad | Unvan |
|---|---|
| TribunKurdu | Tribün Şairi |
| DerbiKahini | Sessiz Analizci |
| KaleciBaba | Bayrak Taşıyıcı |
| AnaliZeka | Sessiz Analizci |
| CaylakCihan | Çaylak Taraftar |

## 🗄️ Veritabanını İncelemek

DB dosyası: `data/tribun.db` (SQLite, WAL modu)

### SQLite komut satırı ile

```bash
# Etkileşimli aç
sqlite3 data/tribun.db

# Tek sorgu
sqlite3 data/tribun.db "SELECT nickname, total_points FROM users ORDER BY total_points DESC LIMIT 10;"

# Tablo şemalarını gör
sqlite3 data/tribun.db ".schema"

# Tüm tabloları listele
sqlite3 data/tribun.db ".tables"

# CSV çıktısı al
sqlite3 -header -csv data/tribun.db "SELECT * FROM scores LIMIT 20;" > skorlar.csv
```

### DB Browser for SQLite ile

1. <https://sqlitebrowser.org/dl/> adresinden indir (Windows kurulumu var).
2. Uygulamayı aç → "Veritabanı Aç" → `tribun/data/tribun.db` seç.
3. "Browse Data" sekmesinde tabloları görebilir, çift tıklayıp düzenleyebilirsin.
4. "Execute SQL" sekmesinde aşağıdaki sorguları çalıştırabilirsin.

> Not: WAL modunda son değişiklikler `-wal` dosyasındadır; DB Browser dosyayı açarken
> `Apply`/`Write Changes` yapman gerekebilir. En temiz yol: önce sunucuyu durdur.

### Örnek SQL Sorguları

```sql
-- En yüksek puanlı 10 kullanıcı
SELECT nickname, fan_title, total_points
FROM users ORDER BY total_points DESC LIMIT 10;

-- En çok oylanan sözlük terimleri
SELECT t.term, SUM(v.value) AS skor, COUNT(v.id) AS oy_sayisi
FROM dictionary_terms t
LEFT JOIN dictionary_votes v ON v.term_id = t.id
WHERE t.hidden = 0
GROUP BY t.id
ORDER BY skor DESC, oy_sayisi DESC
LIMIT 10;

-- Bekleyen raporlar
SELECT r.id, r.content_type, r.content_id, r.reason, u.nickname AS bildiren, r.created_at
FROM reports r JOIN users u ON u.id = r.user_id
ORDER BY r.created_at DESC;

-- Bir kullanıcının oyun bazlı toplam puanı
SELECT game, SUM(points) AS toplam, COUNT(*) AS kac_kez
FROM scores WHERE user_id = 1 GROUP BY game;

-- Bugün kazanılan puanlar
SELECT u.nickname, s.game, SUM(s.points) AS bugun
FROM scores s JOIN users u ON u.id = s.user_id
WHERE substr(s.created_at, 1, 10) = date('now', 'localtime')
GROUP BY u.id, s.game;
```

## 🔌 API Testi (curl)

Windows'ta PowerShell'de `curl.exe` kullan ya da Invoke-RestMethod tercih et.

```bash
# Kayıt
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"nickname\":\"YeniTaraftar\",\"password\":\"sifre123\"}"

# Giriş (JWT döner)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"nickname\":\"TribunKurdu\",\"password\":\"sifre123\"}"

# Ben Kimim? (token'ı yapıştır)
curl http://localhost:3000/api/me -H "Authorization: Bearer TOKEN_BURAYA"

# Liderlik tablosu
curl "http://localhost:3000/api/leaderboard?game=total"
curl "http://localhost:3000/api/leaderboard?game=penalty"

# Rozetler
curl http://localhost:3000/api/badges

# Admin (x-admin-key .env içindeki ADMIN_KEY)
curl http://localhost:3000/api/admin/stats -H "x-admin-key: tribun-admin-2026"
curl http://localhost:3000/api/admin/reports -H "x-admin-key: tribun-admin-2026"
curl http://localhost:3000/api/admin/bingo-rooms -H "x-admin-key: tribun-admin-2026"
```

PowerShell örneği:

```powershell
$login = Invoke-RestMethod -Method Post http://localhost:3000/api/auth/login `
  -ContentType 'application/json' `
  -Body '{"nickname":"TribunKurdu","password":"sifre123"}'
Invoke-RestMethod http://localhost:3000/api/me -Headers @{ Authorization = "Bearer $($login.token)" }
```

## 📁 Proje Yapısı

```
tribun/
  package.json
  .env.example
  server/
    index.js           # Express başlangıç
    db.js              # SQLite bağlantısı + tablolar (+ --reset modu)
    seed.js            # örnek veri
    data/words.js      # küfür/spam filtresi kelime listesi (genişletilebilir)
    data/bingo-events.js    # bingo olay havuzu (65 jenerik olay)
    data/transfer-players.js # 50 uydurma transfer oyuncusu
    middleware/        # auth, rateLimit, moderate
    routes/            # auth, scores, badges, admin, games, dictionary, memories, report, bingo, transfer
    utils/             # helpers, points (günlük limitler), badges
  public/
    index.html         # oyun salonu ana sayfası (SPA)
    admin.html         # admin paneli
    css/base.css       # tema değişkenleri, üst bar, butonlar
    css/components.css # kartlar, sekmeler, tablolar, modal, toast
    css/games.css      # oyun ekranları (penaltı, kâhin, bingo, transfer...)
    js/api.js          # tek API yardımcı modülü
    js/state.js        # kullanıcı durumu (observable)
    js/ui.js           # toast, modal, kopyalama, giriş penceresi
    js/app.js          # hash router + üst menü/alt sekme çubuğu + sayfa temizlikleri
    js/pages/          # her oyun/köşe kendi modülü (bingo.js, transfer.js dahil)
    js/admin.js        # admin paneli mantığı
  data/
    tribun.db          # ilk çalıştırmada oluşur (git'e girmez)
```

## 🔒 Güvenlik Notları

- Şifreler **bcrypt** ile hashlenir, düz metin asla saklanmaz.
- Oturumlar **JWT** ile taşınır; imza anahtarı `.env`'deki `JWT_SECRET`'tan okunur.
- Tüm SQL sorguları **parametreli**, giriş/istek gövdeleri doğrulanır.
- `express-rate-limit` ile genel, giriş/kayıt ve oyun uçlarında ayrı limitler var.
- Sözlük/anı içerikleri ve takma adlar kaydedilmeden önce **Türkçe küfür filtresinden** geçer.
- 3 farklı kullanıcı rapor verirse içerik **otomatik gizlenir**; admin geri açabilir.
- Oyun sonuçları ve puanlar **sunucuda** hesaplanır/doğrulanır (hile önleme).
- `.env` ve `data/` `.gitignore` içinde.

## 🗺️ Yol Haritası

- [x] Aşama 1 — iskelet, veritabanı, auth, puan/rozet, seed, admin
- [x] Aşama 2 — ana sayfa (SPA), giriş/kayıt, Taraftar Kartı, Penaltı, Kâhin, Taraftar Testi, liderlik tablosu
- [x] Aşama 3 — Taraftar Sözlüğü, Anı Defteri, bildirme, moderasyon (blocklist.txt + spam koruması), gelişmiş admin paneli
- [x] Aşama 4 — Bingo odaları ve Transfer oyunu (7 oyunun 7'si aktif)

### Oyun API'leri (Aşama 2)

| Uç Nokta | Metot | Açıklama |
|---|---|---|
| `/api/games/penalty/play` | POST | `{zone:1-6}` → kaleci ve sonuç (gol/kurtarış/auta) sunucuda belirlenir; 5 atışlık seri sunucuda takip edilir, puan seri bitince verilir |
| `/api/games/penalty/state` | GET | Yarım kalan seriyi döndürür (sayfa yenilenince geri yüklemek için) |
| `/api/games/oracle/predict` | POST | `{home, away}` → seed'li deterministik tahmin; günün ilk tahmini +10 puan |
| `/api/games/quiz/submit` | POST | `{answers:[10 seçenek indeksi]}` → taraftar tipi sunucuda hesaplanır, unvana işlenir, +30 puan (günde bir) |

### Maç Günü Bingo (Aşama 4)

| Uç Nokta | Metot | Açıklama |
|---|---|---|
| `/api/bingo/rooms` | POST | Oda kurur: 6 haneli benzersiz kod (karışan O/0, I/1 yok), 24 rastgele olay + ortada BEDAVA hücresi; kurucu otomatik oyuncu olur. Kullanıcı başına en fazla 3 açık oda |
| `/api/bingo/rooms/:code/join` | POST | Odaya katılır; her oyuncuya AYNI 24 olayın KENDİNE ÖZEL karıştırılmış kartı verilir. Oda başına 10 oyuncu, bitmiş odaya katılım yok |
| `/api/bingo/rooms/:code` | GET | Oda durumu + oyuncular (sadece işaret SAYISI döner, kartlar gizli) + kullanıcının kendi kartı. İstemci 3 sn'de bir poll eder |
| `/api/bingo/rooms/:code/mark` | POST | `{idx:0-24}` hücre işaretle/kaldır. Bingo koşulunu (5 satır/5 sütun/2 çapraz) HER istekte SUNUCU kontrol eder; ilk bingo atomik transaction ile kazanır (+30 puan), diğer oyunculara +5 katılım puanı. Hız limiti: 60 istek/dk |
| `/api/bingo/rooms/:code/finish` | POST | Odayı yalnızca KURUCU kapatır |
| `/api/bingo/my-rooms` | GET | Kullanıcının açık olduğu açık odalar |

**Bingo oda mantığı:**
- Olay havuzu `server/data/bingo-events.js` içinde 65 jenerik olay metni var; her odadan rastgele 24'ü seçilir.
- Kart 5×5 = 25 hücre; ortadaki (12. indeks) hücre herkes için baştan işaretli "BEDAVA ⚽".
- Aynı odadaki herkesin kartında AYNI 24 olay vardır ama dizilim oyuncuya özeldir → şans + hız yarışı.
- Bingo koşulu her işaretlemede sunucuda kontrol edilir (istemci sadece indeks gönderir, hile imkânsız).
- İki kişi aynı anda bingo yaparsa `UPDATE ... WHERE status='open'` atomik işlemi sayesinde yalnızca ilk gelen kazanır.
- 24 saatten eski açık odalar ayrı zamanlayıcı olmadan, sorgu sırasında otomatik `finished` yapılır.
- Puanlar: kazanan +30 (bingo günlük limiti 100), katılan herkese +5.

### Hayali Transfer (Aşama 4)

| Uç Nokta | Metot | Açıklama |
|---|---|---|
| `/api/transfer/players` | GET | 50 uydurma oyuncu (`?pos=KL|DF|OS|FV` filtresi) + bütçe (100M) + formasyon tanımları |
| `/api/transfer/squad` | GET | Kullanıcının kayıtlı kadrosu (yoksa `squad: null`) |
| `/api/transfer/squad` | POST | `{formation:'4-3-3'|'4-4-2'|'3-5-2', playerIds:[11 id]}` → tam 11 oyuncu, tekrarsız, geçerli id, formasyon mevki adetleri ve 100M bütçe SUNUCUDA doğrulanır; fiyat/güç istemciden ASLA alınmaz |

**Kadro puanı formülü:**

```
kadro_puanı = toplam_güç + floor((100 − toplam_maliyet) / 2)
```

- Örnek: gücü 801, maliyeti 94.5M olan kadro → 801 + floor(5.5/2) = **803 puan**.
- Mantık: boş kalan bütçe de (her milyon yarım puan) skora katkı verir; hem yıldız kadro hem tutumlu kadro anlamlıdır.
- Puanlama: ilk kayıtta +25; sonraki kayıtlarda yalnızca kadro puanı İYİLEŞTİĞİ kadar puan verilir (günlük transfer limiti 50).
- Transfer liderlik tablosu, oyundan kazanılan puanların (`game='transfer'`) toplamına göre sıralar.

### Aşama 4 curl örnekleri

```bash
# Bingo: oda kur (JWT gerekli)
curl -X POST http://localhost:3000/api/bingo/rooms -H "Authorization: Bearer TOKEN"

# Bingo: odaya katıl
curl -X POST http://localhost:3000/api/bingo/rooms/AB12CD/join -H "Authorization: Bearer TOKEN"

# Bingo: oda durumu (kartın + oyuncu sayıları)
curl http://localhost:3000/api/bingo/rooms/AB12CD -H "Authorization: Bearer TOKEN"

# Bingo: 5 indeksli hücreyi işaretle (bingo kararı sunucudan döner)
curl -X POST http://localhost:3000/api/bingo/rooms/AB12CD/mark \
  -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"idx\":5}"

# Bingo: açık odalarım
curl http://localhost:3000/api/bingo/my-rooms -H "Authorization: Bearer TOKEN"

# Transfer: kaleci havuzu
curl "http://localhost:3000/api/transfer/players?pos=KL"

# Transfer: kadro kaydet (4-3-3: 1 KL + 4 DF + 3 OS + 3 FV)
curl -X POST http://localhost:3000/api/transfer/squad \
  -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d "{\"formation\":\"4-3-3\",\"playerIds\":[5,10,11,12,19,27,28,34,40,48,49]}"

# Transfer: kadrom
curl http://localhost:3000/api/transfer/squad -H "Authorization: Bearer TOKEN"
```

## 🗄️ Aşama 4 Tabloları

| Tablo | İşlev |
|---|---|
| `bingo_rooms` | Oda: kod (benzersiz), kurucu, durum (`open`/`finished`), odanın 24 olayı (JSON), kuruluş zamanı |
| `bingo_players` | Oda-oyuncu eşleşmesi: oyuncuya özgü kart (JSON), işaretli hücreler (JSON), bingo zamanı. `UNIQUE(room_id, user_id)` |
| `transfer_players` | 50 uydurma oyuncu: ad, mevki (KL/DF/OS/FV), güç (60-95), fiyat (M), özellik cümlesi. Sunucu ilk açılışta otomatik doldurur |
| `transfer_squads` | Kullanıcı başına tek aktif kadro (`UNIQUE(user_id)`): formasyon, 11 oyuncu id'si, toplam güç/maliyet/puan |

### Aşama 4 örnek SQL sorguları

```sql
-- En çok bingo kazananlar
SELECT u.nickname, COUNT(*) AS bingo_sayisi
FROM bingo_players bp JOIN users u ON u.id = bp.user_id
WHERE bp.bingo_at IS NOT NULL
GROUP BY u.id ORDER BY bingo_sayisi DESC LIMIT 10;

-- En yüksek kadro puanları
SELECT u.nickname, s.formation, s.total_power, s.total_cost, s.squad_score
FROM transfer_squads s JOIN users u ON u.id = s.user_id
ORDER BY s.squad_score DESC LIMIT 10;

-- Açık bingo odaları (oyuncu sayılarıyla)
SELECT r.code, u.nickname AS kurucu, r.created_at,
       (SELECT COUNT(*) FROM bingo_players bp WHERE bp.room_id = r.id) AS oyuncu
FROM bingo_rooms r JOIN users u ON u.id = r.owner_id
WHERE r.status = 'open'
ORDER BY r.created_at DESC;

-- Bir odadaki herkesin işaret sayısı
SELECT u.nickname, JSON_ARRAY_LENGTH(bp.marked) AS isaretli, bp.bingo_at IS NOT NULL AS bingo_yapti
FROM bingo_players bp JOIN users u ON u.id = bp.user_id
WHERE bp.room_id = (SELECT id FROM bingo_rooms WHERE code = 'ORNEK1');
```

## ⚽ SportScore Fikstür Senkronizasyonu (Aşama 0-3)

Yerel veritabanına `matches` / `teams` / `competitions` tablolarını dolduran,
`SPORTS_SYNC_ENABLED=true` iken çalışan arka plan senkronu. Aşama 0 keşfi:
`docs/sportscore-discovery.md`; örnek yanıtlar: `data/samples/`.

### Nasıl çalışır?

- Her istek **tek bir (lig, UTC günü)** çiftine atılır:
  `GET /api/v1/fixtures/?sport=&date=&competition=<slug>` (`competition`
  parametresi canlı doğrulandı; `count=0` geçerli "o gün maç yok" yanıtıdır).
- Yalnız `is_enabled=1` ligler (11 allowlist: Süper Lig, TFF 1. Lig, Premier Lig,
  La Liga, Serie A, Bundesliga, Ligue 1, UCL, UEL, NBA, EuroLeague) senkron edilir.
- Günlük bütçe: `SPORTSCORE_DAILY_BUDGET` (7000). İstekler arası en az 1 sn.
- Tüm yazılar (takım/maç upsert + feed_missing + unmapped_values + sync_runs +
  sync_state) **tek transaction** içinde; çakışma kilidi `sync_state`'te **kira
  (lease)** tabanlı — süreç çökerse kira bitince devam edilir.

### İstek planı ve günlük tahmin (talimat: kod + README'de hesap)

Türkiye gününün kapsadığı UTC günleri ve sıklıkları (L = açık lig sayısı):

| Pencere | UTC günleri | Sıklık | İstek/gün |
|---|---|---|---|
| Canlı | D ve D+1 | 3 saatte bir (8 tur) | 2×L×8 |
| Dün | D-1 | 6 saatte bir (4 tur) | L×4 |
| Tarih | D-2 | günde 1 tur | L×1 |
| Gelecek | D+2 … D+7 | günde 1 tur | 6×L |
| **Toplam** | | | **27×L** |

**L=11 → 2×11×8 + 11×4 + 11 + 6×11 = 297 istek/gün** (bütçenin ~%4'ü).
Hesap kodda otomatiktir (`estimateDailyRequests()`); zamanlayıcı açılırken
gerçek lig sayısıyla loglanır — lig sayısı değişirse tahmin de değişir.

### Koruma kuralları (upsert)

- NULL/boş değer dolu skoru/alanı ezmez; durum geriye dönmez
  (finished → live/scheduled şüphelidir; loglanır ve atlanır).
- Skor düşüşü yalnız **ardışık iki yanıtta aynı** görünürse kabul edilir.
- Aynı yanıtta aynı `external_id` iki kez geçerse ilki alınır, ikincisi loglanır.
- Başarılı bir (lig, gün) senkronunda dönmeyen `scheduled` maç, art arda **iki**
  başarılı senkronda dönmezse `feed_missing=1` olur: **silinmez**, varsayılan
  okuma API'sinde gizlenir (okuma sorguları `feed_missing = 0` filtresiyle
  yazılmalıdır). Feed'e geri dönerse bayrak sıfırlanır.
- Boş/hatalı yanıt hiçbir kaydı değiştirmez (`sync_runs`'a failed/partial yazılır);
  `count ≥ 100` → "yanıt kesilmiş olabilir" uyarısı `sync_runs.meta`'ya yazılır.

### Admin uçları (x-admin-key ile)

```bash
# Manuel senkron tetikle (arka planda çalışır; ≤ 8 gün)
curl -X POST http://localhost:3000/api/admin/sports/sync/fixtures \
  -H "x-admin-key: tribun-admin-2026" -H "Content-Type: application/json" \
  -d '{"dateFrom":"2026-10-23","dateTo":"2026-10-24"}'
# Tek lig + tek gün:
curl -X POST http://localhost:3000/api/admin/sports/sync/fixtures \
  -H "x-admin-key: tribun-admin-2026" -H "Content-Type: application/json" \
  -d '{"competition":"turkish-super-league","dateFrom":"2026-10-23"}'

# Durum: son sync_runs, sync_state, bugünkü api_usage, etkin sınır,
# unmapped_values özeti, matches özeti, günlük tahmin
curl http://localhost:3000/api/admin/sports/status -H "x-admin-key: tribun-admin-2026"
```

### İlgili tablolar

`matches` (UNIQUE(provider, external_id); `feed_missing`, `miss_streak`,
`finished_at`, `url_path`), `teams` (name_key), `competitions` (`api_name`),
`sync_runs` (her koşu; `meta` = faz/kesilme/çift kayıt/geri dönüş uyarıları),
`sync_state` (kira kilidi + son hata), `api_usage` (UTC gün + uç bazında sayaç),
`unmapped_values` (eşleşmeyen sağlayıcı değerleri).

### Okuma API'si (Entegrasyon Aşama 4)

`server/routes/sports.js` + `server/services/sportsRead.js` — **bu rotalar hiçbir
koşulda SportScore'a istek atmaz** (yalnız SQLite'tan okur → `api_usage` artmaz):

| Uç | Açıklama |
|---|---|
| `GET /api/sports/matches?date=&sport=&competition=&status=` | TR takvim günü (Europe/Istanbul; `Intl` ile hesap — sabit +3 YOK), lige göre gruplu (sort_order, kickoff sıralı); `feed_missing=1` dönmez |
| `GET /api/sports/matches/:id` | Tek maç temel bilgileri (detay Aşama 8) |
| `GET /api/sports/competitions` | is_enabled=1 ligler, sort_order sırasıyla |
| `GET /api/sports/live` | Şu an live/halftime maçlar |

- Skor her zaman **sayı veya null** (başlamamış maçta null; asla 0 yazılmaz).
- `meta`: `{date, timezone, last_fixture_sync_at, last_live_sync_at, stale,
  stale_reason, live_count}` — fikstür 6 saatten eski (`fixture_sync_old`),
  canlı maç varken canlı senkron 5 dk'dan eski (`live_sync_old`), senkron hiç
  yoksa (`no_data`) → `stale=true`.
- Güvenlik: beyaz liste doğrulama (400 + Türkçe mesaj), IP başına 120/dk limit,
  `Cache-Control: max-age=10` + ETag (If-None-Match → 304), hata içeriği sızmaz.
- Test: `server/tests/sportsRead.test.js` (TR gün sınırı, gruplama, doğrulama,
  boş sonuç, NULL skor, stale senaryoları, feed_missing gizleme).

```bash
curl "http://localhost:3000/api/sports/matches?date=2026-10-24&sport=football"
curl "http://localhost:3000/api/sports/matches?status=live"
curl http://localhost:3000/api/sports/competitions
curl http://localhost:3000/api/sports/live
```

### Kabul testleri

```bash
SPORTS_SYNC_ENABLED=true npm start   # birkaç dakika içinde matches dolar
# → Süper Lig, La Liga, Premier Lig maçları görünür
SPORTS_SYNC_ENABLED=false npm start  # hiç istek atılmaz
# Aynı senkron iki kez çalışınca satır sayısı artmaz (upsert);
# internet kesilse bile mevcut maçlar silinmez.
```

## 🔴 Canlı Skorlar (Aşama 5)

`server/services/liveWindow.js` (saf karar çekirdeği; db singleton'u
require ETMEZ — test edilebilirlik) + `server/services/syncLive.js` (yan
etkili tur fonksiyonları) + `server/jobs/liveScoresJob.js` (setTimeout zinciri;
kütüphane YOK). `SPORTS_SYNC_ENABLED=true` iken `index.js` içinde başlar,
SIGINT/SIGTERM'de düzgün durur. widget/matches KULLANILMAZ (10 maç sınırı) —
canlı güncelleme de Aşama 3'teki gibi **lig bazlı fikstür isteğiyle** yapılır.

### Etkin pencere kapısı (API isteği ATMAZ; yalnızca veritabanına bakar)

| Koşul | Etkin mi? |
|---|---|
| (a) durumu `live`/`halftime` olan maç var | ✅ |
| (b) `kickoff_utc` ∈ [şimdi−3,5 sa, şimdi+15 dk] **ve** `scheduled` | ✅ |
| Hiçbiri yoksa | ❌ 10 dk'da bir YALNIZCA DB kontrolü (istek 0; `sync_runs`'a `skipped` yazılır) |

- Etkin her **(lig slug, maçın kickoff UTC GÜNÜ)** çifti için tek fikstür isteği.
  Gece yarısını aşan maçta "bugün" DEĞİL, **o maçın başlangıç tarihi** kullanılır
  (23:30Z'de başlayan maç 01:00Z'de `2026-10-23` çiftiyle sorgulanır).
- Güvenlik: kickoff'u 12 saatten eski çöp `live` kayıtları pencereyi yakmaz
  (Aşama 3'ün 3 saatlik canlı-pencere senkronu onları yine de iyileştirir);
  `feed_missing=1` ve `is_enabled=0` ligler kapıya girmez.

### Tur aralığı (bütçe kademeleri + hata çarpanı)

| Bütçe | Aralık |
|---|---|
| <%70 | temel: **120 sn** (`.env SPORTS_LIVE_INTERVAL_SEC`, asgari 30 sn) |
| ≥%70 | 240 sn |
| ≥%90 | 600 sn |

- Ardışık başarısızlıkta aralık büyür: `kademeli_aralık × min(1+hata, 6)`,
  üst sınır 30 dk (`sync_state.consecutive_failures` motor tarafından artar).
- Tur `skipped` dönerse (restart sonrası önceki sürecin kirası) 90 sn'de bir
  sessiz yeniden deneme (Aşama 3 catch-up deseni).
- İstekler arasında ≥ 1 sn (motor içinde); istek önceliği **critical**
  (%90 bütçede bile canlı skor yaşar).

### Upsert koruma kuralları (Aşama 3'ün tamamı + Aşama 5 eki)

Canlı tur AŞAMA 3 MOTORUNU `jobName='live_scores'` ile çağırır → tek
transaction, kira kilidi (`sync_state`, iş başına satır), NULL ezmez, durum
geri dönüşü yasak (finished→live/scheduled/unknown), skor düşüşü yalnız
ardışık İKİ yanıtta aynı değerse onaylanır (koruma hafızası iki iş arasında
PAYLAŞILIR), `finished_at` ilk geçişte yazılır, `feed_missing`, `unmapped_values`.
Ayrıca: **finished + 24 saat → kayıt donar** (hiçbir alan güncellenmez).
`minute` alanı list yanıtında bulunmadığından canlı iş YAZMAZ (yalnız detay).

### Finiştikten sonra

1. Durum `finished`'a geçince motor `finished_at` yazar.
2. **+30 dk** sonra TEK düzeltme senkronu (öncelik `normal`): "plan" bellekte
   TUTULMAZ — her tur `getCorrectionDue` ile DB'den türetilir
   (`correction_synced_at` NULL + `finished_at` son 2 sa) → süreç çökse bile
   kaybolmaz; senkron başarılıysa kendi 30 dk'sı gelmiş maçlar işaretlenir.
3. **24 saat sonra kayıt donar** (kural yukarıda).

### İstek matematiği (talimat: etkin çift başına saatte 30)

```
saatlik istek = etkin (lig, gün) çifti sayısı × (3600 / aralık)
120 sn → çift başına 30 istek/saat  ·  240 sn → 15  ·  600 sn → 6

Örnek: akşam 5 çift etkin → 5 × 30 = 150 istek/saat;
~2 saatlik maç penceresi ≈ çift başına 60 istek.
Boşta (etkin maç yok): 0 istek — yalnız 10 dk'da bir DB kontrolü.
```

### Admin uçları (x-admin-key)

| Uç | Açıklama |
|---|---|
| `POST /api/admin/sports/sync/live` | Tek seferlik anında tur (isteğe bağlı `{competition}`); pencere kapalıysa istek ATMAZ, nedeni döner |
| `GET /api/admin/sports/status` | `live` bloğu: iş durumu, sıradaki koşu (`next_run_at`), etkin pencere + **etkin (lig, gün) çiftleri**, bütçe seviyesi (`pct`/`tier`), son 5 tur, düzeltme planları, istek tahmini |

`meta.last_live_sync_at` (okuma API'si) artık **live_scores İŞİNİN** gerçek
senkron zamanıdır: boşta kontrolleri (`skipped`) ve Aşama 3'ün `phase:'live'`
pencere koşuları SAYMAZ.

### Testler + kabul

`node --test` → 59/59 (18 normalizer + 18 okuma + 23 canlı skor: pencere
kararları, gece yarısı çifti, bütçe kademeleri, skor düşüşü çift onay, durum
geri dönüşü, dondurma 24 sa, düzeltme türetimi/işaretleme, boşta kaydı,
`last_live_sync_at` semantiği). Not: Node 24 + better-sqlite3 **12.x**
process-exit çökmesi (Statement destructor) 13.0.3'e yükseltmeyle giderildi.

```bash
curl -X POST localhost:3000/api/admin/sports/sync/live \
  -H "x-admin-key: $ADMIN_KEY" -H "content-type: application/json" -d '{}'
curl localhost:3000/api/admin/sports/status -H "x-admin-key: $ADMIN_KEY"
# Canlı maç oynarken: skorlar 2-4 dk içinde DB'de güncellenir;
# etkin maç yokken api_usage ARTMAZ; admin status'ta etkin çiftler görünür.
```

## 🏟️ Ana Sayfada Maç Bölümü (Aşama 6)

Ana sayfada hero banner'ın hemen altındaki **"GÜNÜN MAÇLARI"** bölümü.
Veri: `GET /api/sports/matches?date=YYYY-MM-DD&sport=football|basketball`
(Aşama 4/5 okuma ucu — SQLite'tan okur, SportScore bütçesi **harcanmaz**;
tarayıcı asla doğrudan sağlayıcıya gitmez).

- **Kontroller:** Dün / Bugün / Yarın (varsayılan Bugün; tarih hesabı
  `Europe/Istanbul` takvim günüyle, DST'ye dayanıklı) + Futbol / Basketbol.
  Seçim değişince API yeniden çağrılır. `Canlı (n)` çipi yalnız canlı maçları
  gösterir (istemci tarafı filtre; `n = meta.live_count`, canlı yoksa devre dışı).
- **Lig grupları:** API sırasıyla (Süper Lig üstte); başlık gerçek `<button>` +
  `aria-expanded`, tıklanınca daralır; daraltma durumu otomatik yenilemede
  korunur. Lig sayfası olmadığından başlık link değildir.
- **Durumlar:** Başlamadı · CANLI + periyot (1./2. Yarı, Devre Arası, Uzatma,
  Penaltılar, 1.-4. Periyot) · Bitti · Ertelendi · İptal · Durduruldu ·
  Yarıda Kaldı. Skor `null` → `"-"`, sayıysa sayı (0-0 asla "-" ile karışmaz).
  Dakika listede gösterilmez.
- **Durum yönetimi:** yüklenirken iskelet; veri yoksa "Bu gün için maç
  bulunamadı"; API hatasında "Maçlar şu an yüklenemedi" + "Tekrar dene"
  (seçim değişikliği hatasında eski seçimin verisi gösterilmez; sessiz
  yenileme hatasında eski veri korunur). `meta.stale=true` → "Veriler
  gecikmeli olabilir" şeridi; "Son güncelleme: HH:mm" (TR) her zaman görünür.
- **Otomatik yenileme:** 30 sn'lik hızlı tur YALNIZ Bugün + canlı maç varken;
  canlı yokken Bugün'de 120 sn'lik yavaş keşif yoklaması çalışır (sayfa açıkken
  başlayan maçı fark edip hızlı moda geçer); Dün/Yarın'da hiç yoklama yoktur.
  Sekme gizliyken durur, görününce anında tazeler; rota değişince `cleanup`
  (zamanlayıcı + dinleyici + aktif istek iptali) temizler.
- **Atıf:** bölümün altında ve `index.html`'in statik footer'ında
  `Powered by SportScore` (rel="dofollow", title="Sports data by SportScore").

### Tasarım kararları

- **Yerleşim:** Bölüm hero'nun hemen altına alındı (talimat); marquee bandı
  içerik değişmeden bölümün altında kaldı — diğer bölümlerin sırası korunur.
  Eski `/api/matches` widget panosu ("Bugünün Maçları") bu bölümün yerini
  bıraktı: iki paralel maç listesi tek gerçek kaynakla değiştirildi
  (backend'deki eski uç dokunulmadan durur).
- **Token disiplini:** Yeni renk/font icat edilmedi; `--pitch` (canlı yeşil),
  `--flood`, `--amber` (ertelenme/uyarı), `--redcard` (hata), `--ink/-2`,
  `--line/-soft`, VT323 pixel etiketler, Anton skor tipografisi ve sert ofset
  gölgeleri mevcut sistemden alındı. Tüm yeni stiller **`public/css/sports.css`**
  dosyasında `sp-` önekiyle toplandı; mevcut CSS dosyalarına dokunulmadı.
- **Satır düzeni:** saat | ev sahibi (logo+ad) | skor+durum | deplasman
  (aynalı). Durum etiketi skorun altında (eski pano mirası) — 360px'te tek
  satırda kalır, yatay kaydırma olmaz (ölçüldü: scrollWidth=clientWidth).
  Canlı satırda anlam metinle ("CANLI") verilir; sol yeşil şerit yalnız
  destekleyicidir (renk körlüğü güvenli).
- **Logolar:** 28px `img` (`width/height`, `loading="lazy"`, `alt=""`,
  `referrerpolicy="no-referrer"`); hata/eksik durumunda baş harf yer tutucusuna
  dönüşür (`onerror`, sayfa bozulmaz). Lig logosu hatasında logo sessizce kalkar.
- **Erişilebilirlik:** tüm kontroller gerçek `<button>` (`role="group"` +
  `aria-pressed`); odak halkası global `:focus-visible`; nabız animasyonu
  `prefers-reduced-motion`'da kapalı; tüm dinamik metinler `textContent` ile
  basılır; görsel gizli `aria-live` bölgesi özet duyurur. Satırlar bu aşamada
  tıklanabilir değil (detay Aşama 8'de).
- **JS mimarisi:** davranış `public/js/matchesBoard.js` modülünde; `home.js`
  yalnızca bölüm kabuğunu konumlandırır ve modülün `cleanup`'ını router'a
  döndürür. İstekler `AbortController` ile iptal edilir (hızlı sekme geçişi
  yarış koşulu yok); hatalar yakalanır, konsol kirlenmez.

### Kabul testleri

```bash
npm run dev   # ya da çalışan sunucu
# 1) Ana sayfa: hero altında maç bölümü; Süper Lig üstte, ligler daralıyor
# 2) Dün/Bugün/Yarın + Futbol/Basketbol geçişleri çalışıyor
# 3) Canlı maç varken: CANLI + periyot etiketi, 30 sn'de bir otomatik yenileme
#    (DevTools Network'te /api/sports/matches istekleri), sekme gizliyken durur
# 4) Sunucu erişilemezse: "Maçlar şu an yüklenemedi" + "Tekrar dene"
# 5) 360px'te yatay kaydırma yok; sayfa kaynağında "Powered by SportScore" var
# 6) Giriş, oyunlar, sözlük vb. sayfalar eskisi gibi (konsol hatrası yok)
```

## 🥇 Puan Durumu ve Lig Sayfası (Aşama 7)

- `GET /api/sports/competitions/:slug/standings` (gruplu tablo + `columns` +
  `meta.updated_at/stale`) ve `GET /api/sports/competitions/:slug` (bugün +
  yaklaşan maçlar) — yalnızca SQLite okur.
- Senkron: `services/syncStandings.js` + `jobs/standingsJob.js` — günde 3 tur
  futbol ligi + biten maç tetikleyicisi (≤15 dk), düşük öncelikli bütçe, boş
  yanıt / %50 altı düşüşte RED (eski veri korunur), tek transaction.
- Frontend: `#/lig/:slug` (public/pages/league.js + league.css) — tablo kendi
  kutusunda kayar, ilk iki sütun sabit; ana sayfa lig başlıkları bu sayfaya
  bağlantılı. Üst menüye yeni öğe eklenmedi.

## ⚽ Maç Detayı (Aşama 8 — Yalnızca Futbol)

**Uç:** `GET /api/sports/matches/:id/detail` — SportScore'a istek atabilen TEK
kullanıcı rotası. Basketbolda 404 yerine `200 + {available:false,
reason:'no_detail_for_sport'}`.

- **TTL** (`services/matchDetailCore.js` — SAF, tablo testli): canlı maç 60 sn
  (SportScore önbelleğiyle aynı); başlamamış maç HİÇ çekilmez; bitmiş maç ilk
  başarılı çekimden sonra kalıcı, bitiş+30 dk'da bir kez düzeltme için çekilir.
- **Tek-uçuş:** aynı maçın eşzamanlı istekleri tek ağ çağrısında birleşir
  (maç id bazlı harita; test: 10 eşzamanlı istek = 1 çağrı).
- **Bütçe:** `SPORTSCORE_DETAIL_DAILY_CAP` (varsayılan 1000) günlük ayrı tavan
  + `sportScoreClient` 'low' öncelik kademeleri. Tavan dolu/API hatası → son
  veri `stale:true` ile; hiç veri yoksa `200 + available:false` + Türkçe mesaj.
- **Kimlik denetimi:** yanıtın `tracker.id`'si (yoksa url'deki kimlik)
  `matches.external_id` ile eşleşmezse detay KAYDEDİLMEZ ve loglanır.
- **Skor koruması:** detay skoru listeden düşükse `matches`'e yazılmaz,
  `match_details('scoreboard')` içinde yaşar; `live_minute → matches.minute`,
  `ht_home/ht_away` her zaman yazılır. Durum (status) bu rotada yazılmaz —
  durum geçişleri Aşama 5 korumalarının işidir.
- **Yazma:** tek transaction — `match_details` (scoreboard/events/stats/
  lineups) + matches + `unmapped_values('incident_type'/'stats_label')`.
  Ham sağlayıcı yanıtı dışarı çıkmaz.
- **Hız limiti:** IP başına 30/dk (`detailLimiter`), `no-store`.
- **Frontend:** `#/mac/:id` (public/js/pages/matchDetail.js + match.css) —
  skor tahtası (lig adı `#/lig/:slug`'ya bağlı), iki yana açık olay çizelgesi
  (gol / penaltı golü ayrı ikon / sarı kart / değişiklik / VAR / bilinmeyen
  genel ikon — inline SVG, emoji yok), `home_pct/away_pct` karşılaştırmalı
  çubuklar, mevki gruplu kadrolar (numara + kaptan C; rating GÖSTERİLMEZ,
  saha çizimi YOK), boş bölümler "Bu maç için ... verisi sağlanmıyor".
  Canlı maçta 60 sn'de bir kendi API'mizden yenilenir (sekme gizliyken durur);
  "Son güncelleme" + bayat veri şeridi + "Powered by SportScore".
  Ana sayfada yalnız `has_detail`'li futbol satırları gerçek `<a>` ile bu
  sayfaya bağlanır; basketbol satırları linklenmez. Üst menüye öğe eklenmedi.

### Kabul testleri

```bash
npm test    # 101/101 (17 Aşama 8 testi: tek-uçuş, TTL, kimlik, bütçe, ...)

# 1) Bitmiş futbol maçı (#/mac/7): olaylar + 5 istatistik + kadrolar görünüyor
# 2) Canlı maçta dakika görünüyor (detaydan; ör. "31'")
# 3) Aynı maç sayfası arka arkaya açılınca api_usage neredeyse artmaz
#    (SELECT * FROM api_usage WHERE endpoint='/api/widget/match/')
# 4) Verisi olmayan bölüm "verisi sağlanmıyor" diyor, sayfa çökmüyor
# 5) Basketbol satırları detay sayfasına gitmiyor (link yok)
# 6) API erişilemezse (ağ kesintisi): son detay + "Veriler gecikmeli olabilir"
# 7) 35 hızlı istek → 429 (IP başına 30/dk limiti)
```

## 🔮 Kâhin Sensin Entegrasyonu (Aşama 9)

Gerçek maçlara tahmin oyunu: admin senkronize edilmiş futbol maçlarını tek tıkla
Kâhin Sensin'e aktarır; maç kesinleşince puanlar otomatik dağıtılır. Elle maç
girişi ayrı ve bağımsız olarak çalışmaya devam eder. Önemli not: bu aşamanın
önkoşulunda geçen "mevcut Kâhin Sensin modülü" kod tabanında yoktu (yalnızca
şablon tabanlı kristal küre "Kâhin" oyunu vardı) — modülün temeli bu aşamada
kuruldu; kristal küre oyunu aynen korundu.

### Veri modeli (migration 007; mevcut tablolar değişmedi)

- `fixtures` — tahmin oyunu maçları (elle + senkron ortak şema). `kickoff_at`
  UTC ISO; `status` open/finished/cancelled; `result_1x2`/`result_btts`;
  `review_required`/`review_reason` ("İnceleme gerekli" bayrağı).
- `predictions` — her kullanıcı her maç için tek tahmin (`UNIQUE(fixture_id,user_id)`):
  `pick_1x2` (1/X/2) + `pick_btts` (yes/no). Puan tahmin anında değil, sonuçta:
  `points_awarded` + `award_detail` (ödül küpürü: scores satır id'si — düzeltme
  senaryosunda ödül geri alınırken kullanılır).
- `forecast_match_links` — senkron maçı ↔ fixture bağı (`match_id UNIQUE`,
  `fixture_id UNIQUE`, `created_at`) + otomatik sonuçlandırmanın gözlem durumu
  (`last_observed_at`, `last_home/away`, `stable_count`).

### Puanlama

Sonuç kesinleşince `settleFixture` dağıtır (mevcut puan sistemi + Kâhin günlük
limiti aynen geçerli, oyun anahtarı `oracle`):
`1/X/2 doğru +15 · karşılıklı gol doğru +10 · ikisi birden +5 (toplam 30)`.

### Otomatik sonuçlandırma (talimat kuralları)

Bağlı maç `finished` + iki skor dolu + **finished ilk görüldükten 30 dk geçmiş** +
**son iki senkronda skor aynı** → `settleFixture(by='auto')`. "Son iki senkron"
dürüstçe sayılır: yeni gözlem yalnız `matches.fetched_at` ilerlediyse yapılır.
Sağlayıcı skoru sonradan düzeltirse (maç satırı Aşama 5 korumalarından geçtikten
sonra) aynı fonksiyon yeniden çağrılır (`by='correction'`): eski ödüller geri
alınır (scores satırı silinir, `users.total_points` düşer), yeni sonuç dağıtılır.
Ertelendi/iptal/feed_missing → fixture "İnceleme gerekli" bayrağı alır; otomatik
iptal YOK, kickoff otomatik uygulanmaz — admin karar verir.

Tetikleyiciler: her senkron turunun sonunda (syncFixtures kancası), 5 dakikalık
yalnız-DB süpürme işi (`jobs/forecastJob.js`, istek ATMAZ) ve admin "Maçlar"
sekmesinin açılışı.

### Uç noktalar

- Kullanıcı (giriş gerekli): `GET /api/games/forecast/fixtures`,
  `POST /api/games/forecast/predict {fixtureId, pick1x2, pickBtts}`
  (başlama saatine kadar açık; mükerrer yok).
- Admin (x-admin-key): `GET /api/admin/sports/forecast/candidates` (gelecek 7
  gün, futbol, scheduled, feed_missing=0, açık lig, bağlanmamış),
  `POST /api/admin/sports/forecast/import {matchIds[]}` (tek transaction,
  idempotent; basketbol mesajla reddedilir),
  `GET|POST /api/admin/forecast/fixtures` (liste / elle giriş),
  `POST /api/admin/forecast/fixtures/:id/{settle,cancel,kickoff,resolve}`.

### Arayüz

- `#/kahin-sensin` — tahmine açık maçlar (1/X/2 + KG seçim düğmeleri), kilitli
  tahminler, son sonuçlar (skor + doğru/yanlış etiketleri + puanın). Oyun
  Salonu'nda "YENİ" kartlı. Emoji yok, inline SVG; tüm metinler `textContent`.
- Admin panelinde **Maçlar** sekmesi: "Senkron maçlardan aktar" (onay kutulu
  aday listesi), "Elle maç ekle" (TR saati → UTC dönüşümü sunucuda), maç listesi
  (durum/tahmin sayısı/senkron durumu/inceleme bayrağı + Sonuç Gir · İptal Et ·
  Saati Güncelle · İncelemeyi Kapat).

### Kabul testleri

```bash
npm test    # 119/119 (18 Aşama 9 testi: idempotent aktarım, iki-senkron ve
            #  30 dk kuralları, düzeltme senaryosu, basketbol reddi, bayraklar,
            #  puanlama matrisi, elle giriş, kullanıcı listesi)

# Canlı zincir (gerçek veriyle): node scripts/asama9-acceptance.js
#  1) Adaylar listelenir (yalnız futbol); seçilenler aktarılır; Kâhin Sensin'de görünür
#  2) Aynı maçın ikinci aktarımı "zaten bağlı" döner, satır artmaz
#  3) Basketbol maçı id'si mesajla reddedilir
#  4) Aktarılan bitmiş maç (ör. Aston Villa 2-1 Man City): 1. gözlem sonrası hâlâ
#     açık; gerçek lig senkronu sonrası 2. kararlı gözlem → SONUÇLANDI (by=auto);
#     predictions.points_awarded + users.total_points + scores satırları güncel
#  5) Bağlı maç postponed → "İNCELEME GEREKLİ"; otomatik iptal yok
#  6) Elle girilen maç liste düşer; admin sonuç girişi aynı settleFixture'ı çağırır
```

## 📡 Spor Verisi: Sertleştirme, İzleme ve Belgelendirme (Aşama 10)

Bu bölüm, SportScore entegrasyonunun (Aşama 0-9) tamamını **tek belge** altında toplar:
mimari, ortam değişkenleri, tablolar, kimlik kuralları, zamanlayıcılar, bütçe, admin
izleme uçları, veri tutma politikası, performans denetimi, dayanıklılık testleri ve
güvenlik incelemesi.

### Mimari

```
                ┌─────────────────────────────────────────────────┐
                │              TARAYICI (public/)                 │
                │  index.html · admin.html · app.js (hash-router) │
                │  matchesBoard.js · sports.css · admin.js        │
                └────────┬───────────────────────────▲─────────────┘
      /api/sports/* (yalnız okuma)                  │  /api/admin/* (x-admin-key)
      120 istek/dk · ETag + 304                     │  30 istek/dk (Aşama 10 limiti)
                ┌────────▼───────────────────────────┴─────────────┐
                │            EXPRESS (server/index.js)              │
                │  routes/sports.js → sportsRead.js (SQLite okuma)  │
                │  routes/admin.js  → izleme + manuel senkron       │
                └────────▲──────────────────────────────────────────┘
                         │ better-sqlite3 (WAL) — data/tribun.db
┌────────────────────────▼──────────────────────────────────────────────────┐
│                            SENKRON KATMANI                                 │
│  scheduler.js      fikstür 4 faz: canlı 3sa · dün 6sa · D-2 · gelecek    │
│  liveScoresJob.js  canlı turlar 120sn → 240sn (%70) → 600sn (%90)        │
│  standingsJob.js   3 taban tur/gün + biten maç tetikleri                  │
│  forecastJob.js    300sn, YALNIZ-DB (istek atmayan denetçi)               │
│  retentionJob.js   24 saatte bir, küçük batch'lerle temizlik (Aşama 10)  │
│                                                                           │
│  TÜMÜ ORTAK MOTORU KULLANIR:                                              │
│  syncFixtures.js ← matchGuard.js  (koruma kararları, SAF fonksiyonlar)    │
│       ↑          ← matchNormalizer.js (şema doğrulama, SAF)               │
│  sportScoreClient.js  bütçe(spend) · devre kesici · tek-uçuş · 2 yeniden  │
└────────────┬──────────────────────────────────────────────────────────────┘
             │ HTTPS · UA: TribunLocal/1.0 · AbortSignal.timeout
             ▼
       sportscore.com   — atıf: footer'da görünür "Powered by SportScore" (dofollow)
```

### Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | 3000 | Sunucu portu |
| `JWT_SECRET` | — | JWT imza anahtarı; üretime çıkmadan UZUN ve rastgele yap |
| `ADMIN_KEY` | — | Admin paneli anahtarı; yoksa admin uçları 503 döner |
| `AUTH_RATE_LIMIT` | 20 | Giriş/kayıt istek limiti (15 dk pencere) |
| `SPORTS_SYNC_ENABLED` | false | Tüm senkron işlerinin ana anahtarı |
| `SPORTSCORE_BASE_URL` | https://sportscore.com | Sağlayıcı kök adresi |
| `SPORTSCORE_DAILY_BUDGET` | 7000 | Günlük istek güvenlik tavanı (UTC gün) |
| `SPORTSCORE_TIMEOUT_MS` | 10000 | Tek isteğin zaman aşımı |
| `SPORTSCORE_DETAIL_DAILY_CAP` | 1000 | Maç detayı için ayrı günlük tavan (Aşama 8) |
| `TRIBUN_DB_PATH` | data/tribun.db | DB yolu geçersiz kılma (testler `:memory:`; üretime dokunma) |

### Tablolar ve ilişkiler

- **competitions** — izlenen ligler. `is_enabled` (senkron anahtarı), `slug_status`
  (`active` = allowlist'ten doğrulanmış · `candidate` = adminin elle eklediği aday).
- **teams** — `name_key` kimliğiyle takımlar; `display_name` (Aşama 10) adminin atadığı
  GÖRÜNEN ad. Okuma API'leri `COALESCE(display_name, name)` gösterir; senkron asla
  display_name'i ezmez.
- **matches** — normalize edilmiş maçlar; upsert koruma kuralları Aşama 3/5'te.
- **match_details** — futbol detayı (events/lineups/stats, Aşama 8). 90 gün sonra silinir.
- **standings** — puan durumu (Aşama 7).
- **sync_state** — iş başına kira kilidi (`locked_until/locked_by`), son başarı,
  art arda hata sayacı.
- **sync_runs** — her senkron koşusu (durum, istek, görülen/yazılan/atlanan, hata, meta). 30 gün sonra silinir.
- **api_usage** — UTC gün + uç bazında istek sayacı (bütçenin veri kaynağı).
- **unmapped_values** — eşleşmeyen sağlayıcı değerleri: `status`, `status_text`,
  `team_name`, `incident_type`, `stats_label`.
- **fixtures / predictions / forecast_match_links** — Kâhin Sensin (Aşama 9).

### external_id kuralları

- **Futbol:** url'nin son parçası (ör. `jw2r09hk6lp0rz8`) → `UNIQUE(provider, external_id)`.
  Ertelenirse aynı satır güncellenir (kimlik sabittir).
- **Basketbol:** `<match_slug>@<YYYY-MM-DD UTC>` — aynı gün aynı iki takım oynarsa
  (çift maç) iki kayıt aynı kimliğe düşer; motor İLKİNİ alır, ikincisini
  `meta.duplicates`'a yazar (satır sayısı 1 kalır; dayanıklılık testi 12).

### Takım adları: normalizasyon, alias, görünen ad

1. Feed'deki ad → `name_key` (TR slugify: Ş→s, İ→i, boşluk→tire) = teams kimliği.
2. Bilinmeyen ad ilk kez görülünce `unmapped_values('team_name')`'a yazılır ve
   takım satırı otomatik açılır (alias mekanizması: sağlayıcı adı `teams.name`'de yaşar).
3. Admin isterse **display_name** atar (panel → "Spor Verisi" → Takım Görünen Adları):
   maç listesi, maç detayı VE puan durumu anında yeni adı gösterir.

### Zamanlayıcılar ve istek planı

| İş | Sıklık | İstek maliyeti |
|---|---|---|
| Fikstür (4 faz) | canlı 3sa · dün 6sa · D-2 24sa · gelecek 24sa | 27 × L istek/gün (L=11 → 297) |
| Canlı skor | 120sn; %70 bütçede 240sn, %90'da 600sn; boştada 10 dk DB kontrolü | etkin çift × 30/saat |
| Puan durumu | 3 taban tur/gün + biten maç sonrası ≤15 dk | 3 × F (F=9 → 27) |
| Kâhin Sensin denetçi | 300sn | 0 (yalnız-DB) |
| Retention (Aşama 10) | 24 saatte bir (ilk tur +15 dk) | 0 (dış istek yok) |

### Bütçe ve gün sınırı

- `spend(endpoint, priority)` her istek ÖNCESİ çalışır; sayaç `api_usage`'ta
  **UTC gün** bazlı tutulur (Türkiye saatiyle gece 03:00'te devir; TR "günü"yle
  karıştırma — paneldeki döküm de UTC günü gösterir).
- Kademeler (günlük ETKİN limitin yüzdesi): **%70** → `low` öncelikli istekler
  (detay, D+2..D+7) reddedilir · **%90** → yalnız `critical` (canlı skor + bugün)
  yaşar · **%100** → hepsi durur.
- **429** gelirse: `Retry-After`'a uyulur, devre kesici açılır ve etkin limit o
  anki kullanımın %80'ine çekilir. Gün değişince limit tazelenir.

### Aşama 10 admin uçları (hepsi `x-admin-key` ile)

| Uç | İş |
|---|---|
| `GET /api/admin/sports/overview` | bütçe + 7 gün döküm + kilitler + retention durumu |
| `GET /api/admin/sports/status` | (Aşama 3-9) koşular, unmapped, maç özetleri, canlı/puan işi |
| `GET /api/admin/sports/competitions` | ligler: `is_enabled`, `slug_status`, satır sayaçları |
| `POST /api/admin/sports/competitions` | aday lig ekle → `slug_status='candidate'`, KAPALI başlar |
| `POST /api/admin/sports/competitions/:id` | `{is_enabled?, slug_status?}` — aç/kapat, doğrula |
| `DELETE /api/admin/sports/competitions/:id` | ADAY ligi geri al (yalnız maç kaydı 0 olan adaylar) |
| `GET /api/admin/sports/teams?q=` | takım listesi + feed'den eşleşmeyen adlar |
| `POST /api/admin/sports/teams/:id/display-name` | `{displayName}` ata; boşsa temizle |

Not: okuma API'leri (maç listesi, canlı, maç detayı, puan durumu, lig listesi)
kapatılan ligleri (`is_enabled=0`) tamamen gizler — anahtar yalnız senkronu değil,
görünürlüğü de kapatır.

```bash
KEY="x-admin-key: $ADMIN_KEY"

# İzleme genel bakışı (bütçe, 7 gün dökümü, kilitler, retention)
curl http://localhost:3000/api/admin/sports/overview -H "$KEY"

# Ligleri listele + bir ligi kapat
curl http://localhost:3000/api/admin/sports/competitions -H "$KEY"
curl -X POST http://localhost:3000/api/admin/sports/competitions/4 \
  -H "$KEY" -H "Content-Type: application/json" -d '{"is_enabled": 0}'

# Aday lig ekle, aç ve doğrula (üç adım)
curl -X POST http://localhost:3000/api/admin/sports/competitions \
  -H "$KEY" -H "Content-Type: application/json" \
  -d '{"slug": "turkish-second-league", "sport": "football", "name": "Turkish Second League"}'
# ... veri geldi mi bak: manuel fikstür senkronu + status ...
curl -X POST http://localhost:3000/api/admin/sports/competitions/12 \
  -H "$KEY" -H "Content-Type: application/json" -d '{"is_enabled": 1, "slug_status": "active"}'

# Takıma görünen ad ata
curl -X POST http://localhost:3000/api/admin/sports/teams/17/display-name \
  -H "$KEY" -H "Content-Type: application/json" -d '{"displayName": "GS"}'
```

### Örnek SQL (izleme hile sayfası)

```sql
-- Bugünün koşuları: durum, istek, kayıt sayaçları
SELECT job_name, status, requests_made, records_seen, records_upserted, records_skipped
  FROM sync_runs WHERE started_at >= date('now') ORDER BY id DESC;

-- 7 günlük istek dökümü (UTC gün)
SELECT day_utc, SUM(count) AS toplam FROM api_usage
 WHERE day_utc >= date('now', '-6 days') GROUP BY day_utc ORDER BY day_utc DESC;

-- Kilitli kalan işler (kira süresi geçmemiş)
SELECT job_name, locked_by, locked_until FROM sync_state
 WHERE locked_until > datetime('now');

-- Eşleşmeyen değerlerin özeti
SELECT kind, COUNT(*) AS cesit, SUM(hits) AS hit FROM unmapped_values GROUP BY kind;

-- Retention ne silecek? (30/90 gün kesimleri)
SELECT COUNT(*) FROM sync_runs WHERE started_at < datetime('now', '-30 days');
SELECT COUNT(*) FROM match_details WHERE fetched_at < datetime('now', '-90 days');
```

### Veri tutma politikası (retention)

- `sync_runs` **30 günden** eski koşular silinir; `match_details` **90 günden**
  eski kayıtlar silinir. `matches`, `teams`, `standings` **ASLA silinmez**.
- Günlük bir kez (ilk tur: açılış + 15 dk), her turda en fazla 500 satır silinir ve
  parçalar arasında `setImmediate` ile event loop'a nefes verilir.
- Silme indeksli: `idx_sync_runs_started`, `idx_match_details_fetched` (migration 008).
- Durum izleme: `/api/admin/sports/overview` → `retention` bloğu (son tur, sıradaki tur).

### Performans denetimi (EXPLAIN QUERY PLAN)

`node scripts/asama10-explain-audit.js` 15 sıcak sorgunun planını yazar. Sonuç
(24.10.2026, gerçek DB): **kalabalık tablolarda tam tarama YOK** — maç panosu
(gün+branş, lig+gün), canlı liste, upsert kimlik aramaları, puan durumu, detay,
iş bazlı koşular, retention taramaları ve Kâhin Sensin aday sorgusu hepsi
`SEARCH ... USING (COVERING) INDEX`. Migration 008'le eklenenler:
`idx_sync_runs_job_id`, `idx_sync_runs_started`, `idx_match_details_fetched`.
(Tek "SCAN" admin lig listesindeki `competitions` tablosundadır: 11 satır.)

### Dayanıklılık testleri (12 senaryo)

`node --test server/tests/resilience.test.js` — bütçe 100'e sabitlenmiş
bellek-içi DB + `global.fetch` mock'u ile GERÇEK modüller sınanır:

1. Ağ hatası → 2 yeniden deneme, koşu `failed`, veri sabit
2. Bozuk JSON → yeniden deneme yok, ham gövde sızmaz
3. `count=0` GEÇERLİ (başarı) vs 5xx FAILED — ikisi karışmaz
4. 429 → devre kesici + etkin limit %80'e; sonraki istek ağa çıkmaz
5. Şema değişikliği → geçersiz kayıt atlanır, koşu çökmez
6. Skor metni `'3'` → `3`; çöp skor → kayıt reddi
7. Süreç çökmesi → kira düştükten sonra tur kendini kurtarır; stop çağrıları güvenli
8. Eşzamanlı ikinci senkron → kira kilidi `skipped` + 0 istek
9. Bütçe %70 `low` red · %90 yalnız `critical` · %100 tam dur
10. Gün sınırı: dünkü istekler bugüne karışmaz; limit günle tazelenir
11. DB kilidi: ikinci yazmacı `SQLITE_BUSY`'yi kısa zaman aşımıyla alır
12. Basketbol aynı gün aynı takımlar → İLK kayıt kazanır, tekrarı loglanır

(+ bonus: retention 30/90 gün kesimlerini ve taze kayıtların kaldığını doğrular.)

### Güvenlik incelemesi (7 madde)

1. **Girdi doğrulama:** tüm rotalarda; Türkçe 400 mesajları; slug regex, gün
   doğrulaması (gerçek takvim günü), 0-99 skor sınırları, 8 gün tavanı.
2. **Hız limitleri:** genel 1500/15dk · auth 20/15dk · oyun 60/dk · spor 120/dk ·
   detay 30/dk · **admin 30/dk (Aşama 10 eklendi)**.
3. **Hata mesajları:** istemciye iç ayrıntı yok (genel 500); sağlayıcı ham gövdesi
   loglara/kullanıcıya sızmaz (test 2 kanıtlı).
4. **Admin rotası:** `x-admin-key` + `crypto.timingSafeEqual`; `ADMIN_KEY` yoksa
   503; anahtar yalnız bellekte (localStorage'a asla yazılmaz).
5. **Loglarda sır yok:** JWT_SECRET/ADMIN_KEY/token hiçbir yere loglanmaz; admin
   işlemleri eylemi loglar, anahtarı loglamaz.
6. **textContent:** admin paneli ve maç panosunda TÜM dinamik metinler
   `textContent` ile basılır; `innerHTML` yalnız statik iskelette.
7. **Parametreli SQL:** her yerde `db.prepare(?)`; dinamik tablo adı yalnız sabit
   sözlükten (`CONTENT_TABLES`); LIKE aramalarında joker kaçışı.

### Atıf

Footer (tüm sayfalarda): **"Powered by SportScore"** — `rel="dofollow noopener"`,
görünür metin, `https://sportscore.com/` (Aşama 0 kuralı, değiştirilmez).

### Sorun giderme

| Belirti | Neden ve çözüm |
|---|---|
| Maç listesi boş | Senkron kapalı (`SPORTS_SYNC_ENABLED`) ya da henüz koşmadı → admin panelinden manuel fikstür senkronu; `sync_runs`'a bak |
| `meta.stale: fixture_sync_old` | Son başarılı senkron 6+ saat önce → işin turlarını `/api/admin/sports/status`'tan denetle |
| `meta.stale: live_sync_old` | Canlı maç var ama son canlı tur 5+ dk önce → canlı işin durumuna bak; bütçe %90+ olabilir |
| 429/devre kesici | `overview`'da etkin limit düşük görünür → gün değişince kendiliğinden tazelenir; acilse bütçeyi artır |
| Kilit sıkıştı | 10 dk içinde kira kendiliğinden düşer; acilse `sync_state.locked_until`'ı geçmişe çek |
| Yeni takım adları `unmapped_values`'ta | Normaldir: ilk senkronda satır açılır; isterse görünen ad atanır |

### Yayına alma notları

- `.env`'de UZUN rastgele `JWT_SECRET` ve `ADMIN_KEY`; `.env` ASLA commit'lenmez.
- Üretimde örnek kullanıcı istenmiyorsa `npm run seed` ÇALIŞTIRMA.
- SQLite tek dosya: düzenli yedek için `npm run db:backup` (VACUUM INTO — tutarlı kopya,
  sunucu açıkken güvenli).
- Reverse proxy (Caddy/nginx) arkasında `trust proxy` zaten 1; IP bazlı limitler gerçek
  istemci IP'sini görür.
- Retention ilk turu açılıştan 15 dakika sonradır; sessiz saatlerde çalışır.
- Sağlayıcı tarafı değişirse (yeni durum/olay türleri) `unmapped_values` büyür —
  panelde görür, eşleme tablolarını (`matchNormalizer` sabitleri) güncellersin.

