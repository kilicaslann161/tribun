/**
 * Tribün — izlenen spor ligleri (allowlist)
 * Kaynak: docs/sportscore-discovery.md (Aşama 0) — yalnızca DOĞRULANAN ligler.
 * Her kayıt: externalId (sportscore kimliği), slug, sport, name (sağlayıcıdaki kayıtlı ad),
 * country (competition URL'sindeki ülke/bölüm parçası), sortOrder (küçük olan üstte).
 *
 * NOT (Aşama 0 arama geçmişi): "TFF 1. Lig", "TFF", "1. Lig" sorguları 0 sonuç vermişti;
 * lig "Turkish First League" adıyla doğrulandı (data/samples/208-son-search-turkish-first.json).
 * Aşama 0 itibarıyla bulunamayan hedef lig YOK (11/11 doğrulandı).
 */
module.exports = {
  SPORTS_COMPETITIONS: [
    { externalId: '8y39mp1h6jmojxg',  slug: 'turkish-super-league',            sport: 'football',   name: 'Turkish Super League',            country: 'turkey',         sortOrder: 1,  logoUrl: 'https://img.thesports.com/football/competition/88c3b85732ee112ba91f7868272d1aa1.png' },
    { externalId: '9k82rekhgorepzj',  slug: 'turkish-first-league',            sport: 'football',   name: 'Turkish First League',            country: 'turkey',         sortOrder: 2,  logoUrl: 'https://img.thesports.com/football/competition/d09a3b1ab92ce378a5277b79a98dac59.png' },
    { externalId: 'jednm9whz0ryox8',  slug: 'english-premier-league',          sport: 'football',   name: 'English Premier League',          country: 'england',        sortOrder: 3,  logoUrl: 'https://img.thesports.com/football/competition/3549f192c75cbc737a05fd51ecad383e.png' },
    { externalId: 'vl7oqdehlyr510j',  slug: 'spanish-la-liga',                 sport: 'football',   name: 'Spanish La Liga',                 country: 'spain',          sortOrder: 4,  logoUrl: 'https://img.thesports.com/football/competition/1fbbb4be3b47d9465c5badecc3122e07.png' },
    { externalId: '4zp5rzghp5q82w1',  slug: 'italian-serie-a',                 sport: 'football',   name: 'Italian Serie A',                 country: 'italy',          sortOrder: 5,  logoUrl: 'https://img.thesports.com/football/competition/6b38f4015a6b3309ad9462e6ce27ae99.png' },
    { externalId: 'gy0or5jhg6qwzv3',  slug: 'bundesliga',                      sport: 'football',   name: 'Bundesliga',                      country: 'germany',        sortOrder: 6,  logoUrl: 'https://img.thesports.com/football/competition/0c6a25cd746e802296d9064b4504179d.png' },
    { externalId: 'yl5ergphnzr8k0o',  slug: 'french-ligue-1',                  sport: 'football',   name: 'French Ligue 1',                  country: 'france',         sortOrder: 7,  logoUrl: 'https://img.thesports.com/football/competition/6e13222836235b121c1af3bc3055e76b.png' },
    { externalId: 'z8yomo4h7wq0j6l',  slug: 'uefa-champions-league',           sport: 'football',   name: 'UEFA Champions League',           country: 'world',         sortOrder: 8,  logoUrl: 'https://img.thesports.com/football/competition/ac05535bde17129cb598311242b3afba.png' },
    { externalId: '56ypq3nh0xmd7oj',  slug: 'uefa-europa-league',              sport: 'football',   name: 'UEFA Europa League',              country: 'world',         sortOrder: 9,  logoUrl: 'https://img.thesports.com/football/competition/1792ba5a12171fedc6d543bdf173f37c.png' },
    { externalId: '49vjxm8xt4q6odg',  slug: 'national-basketball-association', sport: 'basketball', name: 'National Basketball Association', country: 'united-states', sortOrder: 10, logoUrl: 'https://img.thesports.com/basketball/competition/061f5ab5b1a975fc1004529ec3f11fca.png' },
    { externalId: 'jednm9ktd5ryox8',  slug: 'euroleague',                      sport: 'basketball', name: 'EuroLeague',                      country: 'world',         sortOrder: 11, logoUrl: 'https://img.thesports.com/basketball/competition/3ffc7c468bbf72b4e7f86e468351272d.png' }
  ]
};
