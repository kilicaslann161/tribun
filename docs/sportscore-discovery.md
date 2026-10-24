# SportScore Keşif Raporu — Aşama 0 (salt okunur)

**Tarih:** 19 Ekim 2026 (UTC) · **Keşif istekleri:** 41 (üst sınır ~80) · **429/hata serisi:** YOK
**Kaynak:** `https://sportscore.com` doğrudan API (RapidAPI **kullanılmıyor**, anahtar **gerekmiyor**)
**Örnek yanıtlar:** `data/samples/` (35 dosya) · **Betikler:** `scripts/discover-sportscore{,2,3}.mjs`, `scripts/analyze-samples{,2,3,4}.mjs`

> Not: `data/samples/` zaten `.gitignore`'daki `data/` kuralı tarafından kapsanır; `.gitignore` dosyasına dokunulmadı.

---

## A) Proje Denetimi

| Konu | Bulgu |
|---|---|
| `package.json` | `"type"` **YOK → CommonJS**. Scriptler: `start`, `dev` (nodemon), `seed`, `db:reset`. Bağımlılıklar: express, better-sqlite3, bcryptjs, cors, dotenv, express-rate-limit, jsonwebtoken (+dev: nodemon). **Yeni bağımlılık eklenmedi.** Engines: node ≥18; çalışan sürüm **v24.12.0** |
| `server/index.js` | Express; `/api` altında rotalar; `public/` statik; genel JSON 404 + hata yakalayıcı; `app.disable('x-powered-by')` |
| `server/db.js` | Pragma: **WAL + foreign_keys=ON**. Tablolar (11): `users, scores, badges, dictionary_terms, dictionary_votes, memories, bingo_rooms, bingo_players, transfer_players, transfer_squads, reports`. Migration: **VAR** — `PRAGMA table_info` kontrolü + `ALTER TABLE bingo_players ADD COLUMN card` örneği (şablon olarak kullanılabilir) |
| Middleware | `auth.js` (`requireAuth`, `optionalAuth` — JWT; `requireAdmin` — `x-admin-key` zaman-sabit karşılaştırma), `rateLimit.js` (genel 1500/15dk, auth 20/15dk `.env.AUTH_RATE_LIMIT`, oyun 60/dk, içerik 10/saat kullanıcı bazlı), `moderate.js` (küfür/spam/oto-gizleme) |
| Route dosyaları | `auth, scores, badges, games, dictionary, memories, report, bingo, transfer, admin, matches` (sonuncu: mevcut widget panosu `/api/matches`) |
| `.env` / `.env.example` | `PORT, JWT_SECRET, ADMIN_KEY, AUTH_RATE_LIMIT` — SportScore değişkeni **yok** (anahtar gerektirmeyen kaynak) |
| Frontend | **Düz vanilla JS (React DEĞİL)**, ES Modules; özel hash router (`public/js/app.js`, `ROUTES` + `NAV_BY_ROUTE` + cleanup deseni). CSS token'ları: `public/css/base.css` `:root` (renk/boşluk/radius/gölge/z-index), `components.css` (bileşenler), `games.css` (oyun sayfaları). Ana sayfa: **`public/js/pages/home.js`** |
| Hero ("Bugünün Oyunu") DOM | `section.card.hero-featured[data-reveal] > .hero-top(.kicker + .stickwrap .sticker) + .hero-body(.hero-copy(h1+p+.btn.big) + .hero-icon[data-acc])` — `#homeTrack` marquee ile devamı |
| Ana sayfa bölüm sırası | ① hero-featured ② marquee ticker ③ **matches-board** (canlı maç panosu, `/api/matches`) ④ footer |
| Statik kabuk + footer | `public/index.html`: header/nav/main/footer + mobil tab bar; footer'da statik `Powered by SportScore` atfı (`rel="dofollow noopener"`, `title`) |
| Tablo adı çakışması | Aday adlar `matches, competitions, teams, standings, sync_runs, sync_state, api_usage, match_details` → mevcut 11 tabloyla **ÇAKIŞMIYOR**. (`matches` route adı olarak var; tablo olarak yok. `fixtures` tablosu da yok.) |
| "Kâhin Sensin" / `fixtures` / `settleFixture` | **PROJEDE YOK** — projede yalnız "Kâhin" adlı tahmin oyunu var (`server/routes/games.js` içinde `/api/games/oracle/predict`); tablosu/fixture kavramı bulunmuyor. Entegrasyon planlanıyorsa ayrıca tanımlanmalı |

---

## B) Doğrulanmış Uç Noktalar (sportscore.com)

Tüm çağrılar **anahtarsız** çalıştı. OpenAPI: `https://sportscore.com/developers/openapi.yaml` (200; `cache-control: public, max-age=14400`).

### Parametre tanımları (components/parameters)
| Parametre | Zorunlu | Şema |
|---|---|---|
| `sport` | **evet** | enum: `football, basketball, cricket, tennis` |
| `slug` | uç bazlı | string — "URL-friendly slug of the target entity" |
| `limit` | hayır | int, **1–50**, default **10** |

### Uçlar
| Uç | Parametreler (doğrulanmış) | Durum | Not |
|---|---|---|---|
| `GET /api/widget/matches/` | `sport`*, `limit` | ✅ 200 | `{sport, count, matches[10], updated}`; default 10, `limit=50` → **50 maç döndü** (üst sınır=50 teyit). `cache-control: public, max-age=60`. **Lig filtresi YOK** |
| `GET /api/v1/matches/` | `sport`*, `limit` | ✅ 200 | Widget/matches ile **aynı şema**; `limit=2` → 2 maç döndü (limit çalışıyor) |
| `GET /api/v1/fixtures/` | `sport`*, `date` (Y-m-d), `status`, `competition`, `team`, `limit` | ✅ 200 | `{sport, date, count, matches[100]}` — date+sport ile **100 maç**; statü dağılımı: 98 finished + 2 upcoming. **Lig filtresi `competition` parametresiyle VAR** (openapi bildirimi; response örneği tek lig olmadığı için davranış testi DOĞRULANMADI) |
| `GET /api/widget/match/` | `sport`*, `slug` | ✅ 200 | Maç detayı (bkz. şema aşağıda); slug = maç URL'sindeki `<ev>-vs-<deplasman>` parçası |
| `GET /api/widget/standings/` | `sport`*, `slug` | ✅ 200 | `{sport, competition, competition_logo, competition_slug, tables[]}` |
| `GET /api/widget/topscorers/` | `sport`*, `slug`, `stat` (enum `goals`,`assists`) | ✅ 200 | Şema döndü ama Serie A için `scorers: []` **boş** |
| `GET /api/widget/team/` | `sport`*, `slug`, `limit` | ⚠️ **503** | Tek deneme, geçici sunucu hatası — DOĞRULANAMADI |
| `GET /api/v1/search/` | `q`, `sport`*, `limit` | ✅ 200 | `{sport, query, teams[], competitions[], players[]}` — **prefix/alfabetik** davranış |
| `GET /api/v1/h2h/` | `sport`, `team1`, `team2`, `limit` | — | OpenAPI'de tanımlı; **denenmedi** |
| `GET /api/v1/topscorers/`, `/api/widget/player/`, `/api/widget/bracket/`, `/api/widget/tracker/` | çeşitli | — | Denenmedi / kapsam dışı |

**`/api/v1/fixtures/` anahtar/şart durumu:** HTTP 200 **anahtarsız**; `www-authenticate`/`authorization` header'ı YOK; herhangi bir rate-limit header'ı YOK. OpenAPI başlığı: *"SportScore Public API … Free REST API"*. (Kullanım şartları sayfası içeriği DOĞRULANAMADI — bkz. son bölüm.)

---

## C) Veri Şemaları (gerçek örneklerden)

### Maç satırı — `widget/matches`, `v1/matches`, `v1/fixtures` (ortak)
```
home:"São Paulo - SP"            away:"Vasco da Gama Saf - RJ"
home_logo / away_logo            → https://img.thesports.com/football/team/<hash>.png
home_score:"1" away_score:"0"    → STRING; başlamamış maçta boş
status:"finished"                → enum: live | finished | upcoming (openapi)
status_text:"Finished"           → İngilizce insan-okur metni
time:"2026-10-18T00:00:00+00:00" → ISO 8601, UTC (+00:00). SAAT KISMI GÜVENİLMEZ (00:00:00 kaba)
competition:"Brazilian Serie A"  competition_logo:…competition/<hash>.png
url:"/football/match/<slug>/<id>/"
```
Futbol ↔ basketbol: **alan seti birebir aynı**; yalnız logolar `…/basketball/…` yolunda. (Detay düzeyinde basketbol örneği boş geldi — bkz. DOĞRULANMADI.)

### Maç detayı — `widget/match` (futbol, bitmiş)
```
{sport, match:{ …üstteki tüm alanlar…,
  live_minute: null                     → canlı maçta dakika beklenir (örnek: bitmiş maç)
  home_ht_score/away_ht_score: "0"      → devre skoru
  incidents:[{ time:68, type:"Goal", type_id:1, side:"home",
               player:"Artur Victor Guimarães", is_goal:true,
               home_score:1, away_score:0 }]   → olay sonrası skor DAHLİ
             { time:42, type:"Yellow card", type_id:3, side:"away", is_card:true }
             { time:45, type:"Substitution", type_id:9, is_sub:true,
               player_in:"Lucas Moura", player_out:"Luciano" }
             { time:…, type:"VAR", … }
  stats: []                             → bu maçta boş
  lineups:{ confirmed:true, home_formation:null, away_formation:null,
            home_coach/away_coach: null,
            home_xi:[{ name, number, position:"D|M|F|G", captain, rating }], away_xi:[…] }
  tracker:{ id, profile, sport }
}}
```
**Kadro/İlk 11:** `lineups.home_xi/away_xi` — GELİYOR (futbolda). **Olaylar:** `incidents` — GELİYOR. **İstatistik:** `stats` alanı mevcut ama örnek maçta boş.

### Puan durumu — `widget/standings`
```
{ sport, competition:"Italian Serie A", competition_slug, competition_logo,
  tables:[ { group:"",                      → grup etiketi (örneklerde hep tek tablo)
             rows:[ { pos:1, team:"Inter Milan", team_logo, team_slug, team_url,
                      p:7, w:6, d:1, l:0, gf:21, ga:9, gd:12, pts:19,
                      promo_color:"#fa8072", promo_name:"Champions League league stage" } ] } ] }
```
UCL: **36 satırlık TEK tablo** (2024+ "lig usulü" format — klasik grup tablolu örnek görülemedi). `promo_color/promo_name` → Avrupa kotası renklendirmesi.

### Arama — `v1/search`
```
{ sport, query, teams:[{name, slug, logo, url:"/football/team/<slug>/<id>/"}],
  competitions:[{name, slug, logo, url:"/football/competition/<ülke>/<lig-slug>/<kimlik>/"}],
  players:[…] }
```
Davranış: **alfabetik prefix** — "Premier League" sorgusu A/B harfleriyle başlayan sonuçları döndürür; aradığın lig için **tam bilinen ad** kullan ("English Premier League" gibi).

### Hedef ligler (10/11 BULUNDU — tahmin yok, hepsi search yanıtından)
| Hedef | Kayıtlı ad | slug | kimlik |
|---|---|---|---|
| Süper Lig | Turkish Super League | `turkish-super-league` | `8y39mp1h6jmojxg` |
| TFF 1. Lig | Turkish First League | `turkish-first-league` | `9k82rekhgorepzj` |
| Premier League | English Premier League | `english-premier-league` | `jednm9whz0ryox8` |
| La Liga | Spanish La Liga | `spanish-la-liga` | `vl7oqdehlyr510j` |
| Serie A | Italian Serie A | `italian-serie-a` | `4zp5rzghp5q82w1` |
| Bundesliga | Bundesliga | `bundesliga` | `gy0or5jhg6qwzv3` |
| Ligue 1 | French Ligue 1 | `french-ligue-1` | `yl5ergphnzr8k0o` |
| UEFA Şampiyonlar Ligi | UEFA Champions League | `uefa-champions-league` | `z8yomo4h7wq0j6l` |
| UEFA Avrupa Ligi | UEFA Europa League | `uefa-europa-league` | `56ypq3nh0xmd7oj` |
| NBA | National Basketball Association | `national-basketball-association` | `49vjxm8xt4q6odg` |
| EuroLeague | EuroLeague | `euroleague` | `jednm9ktd5ryox8` |

> TFF 1. Lig notu: "TFF 1. Lig", "TFF", "1. Lig" sorguları 0 sonuç vermişti; sağlanan ipucuyla **"Turkish First"** sorgusu doğrulandı (örnek: `data/samples/208-son-search-turkish-first.json`). **11/11 hedef lig doğrulandı.**

Competition sayfa URL kalıbı (doğrulandı): `/football/competition/<ülke-slug>/<lig-slug>/<kimlik>/` — ülke yerine `world` (UCL, EuroLeague) veya `united-states` (NBA) gelebilir.

### Statüler, zaman, logo
- **Statü enum:** `live | finished | upcoming` (openapi). Gerçekte `finished`/`upcoming` gözlemlendi; `live` örnek görülmedi.
- **Zaman:** tüm `time`/`updated` alanları **ISO 8601 UTC** (`+00:00`). UTC saklayıp Europe/Istanbul (+03) gösterim mevcut kurala uygun.
- **Logo:** her zaman gelir; `https://img.thesports.com/<spor>/(team|competition)/<hash>.png` (bazı .jpg). Arka uç sağlayıcı **TheSports**.

### Rate limit / önbellek / hata biçimleri
- Rate-limit header'ı: **HİÇBİR uçta yok** (`x-ratelimit-*`, `retry-after` yok).
- Önbellek: `widget/matches` `max-age=60`; `widget/match` `max-age=30`; `v1/fixtures` `max-age=60`; `v1/search` `max-age=300`; openapi `max-age=14400`.
- Hata: bilinmeyen path → RapidAPI proxy'si tarzı JSON DEĞİL; **sportscore.com 404 = HTML sayfa** (SPA kabuğu). `widget/team` → 503 (geçici).

---

## D) Sonraki Aşamaları Etkileyecek Riskler

1. **Resmi olmayan/şartsız erişim:** v1+widget uçları anahtarsız ve ücretsiz görünuyor; fakat kullanım şartları sayfası (robots/bot koruması) DOĞRULANAMADI. Topluluk widget'ı gibi davranıyoruz — User-Agent açık tutulmalı, istek bütçesi düşük tutulmalı (mevcut: 120 sn önbellek).
2. **`time` saati gün kaba değeri** (çoğunlukla `00:00:00`) — saat bazlı program listesi için güvenilmez; "bugünün maçları" ekranda saat dilimiyle gösterilirken buna dikkat.
3. **widget/matches en fazla 50 maç**, lig filtresi yok — hedef ligleri filtrelemek istiyorsak `v1/fixtures/?date=&sport=` (100+ maç, `competition` filtresi openapi'de var ama test edilmedi) çekip **bizim tarafımızda** lig filtresi uygulamak gerekebilir.
4. **Search prefix davranışı** — yanlış adla arama benzer adlı başka ligleri döndürür (ör. "Premier League" → Ermenistan PL). Kodda **hard-code slug tablosu** (yukarıdaki 10 doğrulanmış lig) kullanılmalı; search yalnız insan aramasında.
5. `stats[]`/`topscorers` örnekleri boş geldi; dolu şema görülmeden UI tasarlanmamalı.
6. `widget/team` 503 — tekrar denenmeli ya da bu aşamada kullanılmamalı.
7. Logolar `img.thesports.com`'dan — CSP/img politikası ileride eklenirse buna izin verilmeli.
8. Türkçe karakterli sorgular URL-encode edilmeli (`Süper Lig` → `%C3%9C…`; çalışıyor).

---

## DOĞRULANAMADI (açık liste)

1. `status:"live"` gerçek yanıtta hiç gözlenmedi (yalnız openapi enum'u).
2. `widget/team/` ucu — 503 (tek deneme).
3. `topscorers` dolu örnek (Serie A `scorers: []`).
4. `stats[]` dolu örnek (örnek maçta boş dizi).
5. Basketbol maç detayında `incidents/lineups/stats` doluluğu (örnek: U21 maçı, hepsi boş).
6. Gruplu/aşamalı puan durumu (`group` hep `""`; klasik grup UCL formatı artık yok, 36'lık tek tablo).
7. `v1/fixtures`'ın `competition`/`team`/`status` filtrelerinin gerçek davranışı (yalnız openapi bildirimi).
8. `v1/h2h`, `widget/player`, `widget/bracket`, `widget/tracker` uçları — denenmedi.
9. Kullanım şartları sayfası içeriği (sportscore.com 403 veriyor) ve resmi istek limiti politikası (429 hiç tetiklenmedi; header yok).
10. ~~TFF 1. Lig'in kayıt adı/slug'ı~~ → **doğrulandı:** `turkish-first-league` / `9k82rekhgorepzj` (208 numaralı örnek).
11. `time` alanının saat hassasiyeti (örneklerin hepsinde `00:00:00`).
12. v1 uçlarının uzun vadeli kararlılığı (sürümleme/erişim koşulları bilinmiyor).

---

## Kabul Kriterleri Kontrolü

- [x] `docs/sportscore-discovery.md` oluştu (bu dosya)
- [x] `data/samples/` altında 35 gerçek yanıt dosyası var
- [x] `data/tribun.db` ve mevcut kod değişmedi (yalnız `scripts/`, `data/samples/`, `docs/` yazıldı; sunucu ayakta ve logları temiz)
- [x] Hedef ligler: **11/11 bulundu** (slug+kimlik; TFF 1. Lig ipucuyla doğrulandı)
