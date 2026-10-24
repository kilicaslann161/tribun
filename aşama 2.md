AŞAMA 2: İSTEMCİ, NORMALİZE KATMANI VE İSTEK BÜTÇESİ
Önkoşul: Aşama 0-1. Bu aşamada veritabanına maç yazılmaz; yalnızca api_usage ve unmapped_values yazılır.
1. server/services/sportScoreClient.js:
• Tek giriş noktası; base URL .env'den. Tüm istekler AbortSignal.timeout(SPORTSCORE_TIMEOUT_MS) ile.
• Açık User-Agent ("TribunLocal/1.0").
• Yalnızca ağ hatası ve 5xx için en çok 2 yeniden deneme (üstel geri çekilme + rastgele sapma). 4xx için yeniden
deneme yok.
• 429: Retry-After'a uy; devre kesici (circuit breaker) aç, süre dolana kadar istek atma; ayrıca kural 4'teki gibi günlük
etkin sınırı o ana kadarki istek sayısının %80'ine çek. Art arda 5 hata sonrası kısa süreli devre kesici.
• Yanıt boyutu üst sınırı; JSON ayrıştırma hataları yakalanır; ham hata gövdesi loglara ve kullanıcıya sızmaz.
• Tek-uçuş (single-flight): aynı URL için eşzamanlı çağrılar tek istekte birleşir.
• Rate limit ile ilgili header'ları (adında ratelimit veya retry-after geçenler) varsa sync_runs.meta'ya yaz.
• Bütçe: her çağrıdan önce api_usage tablosunda UTC gün + uç nokta bazında sayaç artır. Günlük etkin sınırın
%70'inde düşük öncelikli istekler (detay, D+2..D+7 fikstürü) reddedilir, %90'da yalnızca canlı skor ve bugünün fikstürü
çalışır, %100'de hepsi durur. spend(endpoint, priority) imzası kullan.
• Sarmalayıcılar: fetchFixtures({sport, date, competitionSlug}) ve fetchMatchDetail({sport, matchSlug}).
widget/matches'i KULLANMA. URL'ler ve parametreler yukarıdaki doğrulanmış gerçeklerdeki gibi olsun. Kod
yorumlarına doğrulanmamış parametreleri yazma.
2. server/services/matchNormalizer.js (saf fonksiyonlar, DB'ye yazmaz):
• normalizeListMatch(raw, sport, competitionRow) ve normalizeDetail(raw, sport).
• Skor: metin -> tam sayı; null kalırsa NULL; sayıya çevrilemeyen değerde kayıt reddedilir. Asla varsayılan 0 yazma.
• Zaman: time alanı UTC ISO'ya (Z ile) normalize edilir; geçersizse kayıt reddedilir.
• Durum eşleme (tek bir tabloda): status "live" -> live (period'u status_text'ten çıkar); status "finished" -> finished; status
"upcoming" (status_text "Not started") -> scheduled; bunların dışındaki her değeri unmapped_values'a yaz ve şu
yedek kuralı uygula: skorlar NULL ve time gelecekteyse scheduled, aksi halde unknown. Ertelendi, iptal vb. için
yalnızca raporda doğrulananları eşle, gerisini unknown + unmapped_values.
• status_text -> period eşlemesi: "1st half"->H1, "2nd half"->H2, "half time"/"halftime"->HT, "extra time"->ET,
"penalties"/"penalty shootout"->PEN, "1st/2nd/3rd/4th quarter"->Q1-Q4, "overtime"->OT. Yalnızca "2nd half", "1st
quarter" ve "Finished" doğrulandı; diğerleri tahmindir: eşleşmezse period boş bırakılır ve unmapped_values'a yazılır.
• external_id: futbolda url'nin son parçası; basketbolda "<match_slug>@<YYYY-MM-DD UTC>". match_slug url'deki
takım slug'ı (futbolda sondan bir önceki parça, basketbolda son parça). url_path'i sakla.
• Takım: name_key ve alias kuralını Aşama 1'deki gibi uygula; yeni ad görülürse unmapped_values('team_name')
kaydı oluştur.
• Detay normalizasyonu (yalnızca futbol): incidents için type_id'ye göre iç tür (goal=1, penalty_goal=8, yellow_card=3,
substitution=9, var=28; diğerleri 'other' + unmapped_values('incident_type')); stats için label'ı sözlükle Türkçeye çevir
(Ball Possession -> Topla Oynama, Shots on Target -> İsabetli Şut, Shots off Target -> İsabetsiz Şut, Attacks ->
Ataklar, Dangerous Attacks -> Tehlikeli Ataklar; bilinmeyen etiket olduğu gibi ve unmapped_values'a); lineups için
rating'i at, formation null olabilir. live_minute metni tam sayıya çevir. Basketbol detayı normalize edilmez.
Tribün · SportScore Entegrasyonu · Analiz ve Aşamalı Uygulama Dokümanı
Sayfa 18
• Şema doğrulaması: her kayıt için {ok, value, errors}. Geçersiz kayıt atlanır, sayılır ve loglanır; tüm yanıtı düşürmez.
Yeni bağımlılık ekleme; elle doğrulama yaz.
3. Test (node:test): sağladığım örnek yanıtlara benzeyen sabit test verileri üzerinde: futbol url'sinden kimlik çıkarma,
basketbol external_id üretimi, skor metin->sayı ve null durumu, durum/period eşleme, bilinmeyen durumun
unmapped_values'a yazılması, takım adı alias kuralı, olay ve istatistik normalizasyonu. npm test script'i ekle.
4. Henüz hiçbir rota veya frontend değişikliği yok.
Kabul kriterleri (kendi tarafında kontrol)
• npm test geçiyor.
• Örnek yanıtlardan normalize edilmiş maçlarda durum, skor (NULL/0), UTC zaman, external_id doğru.
• Bilinmeyen durum eklenince uygulama çökmüyor, unmapped_values'a yazılıyor.
• api_usage tablosu bir deneme çağrısından sonra sayaç tutuyor.
Bana iletilecekler
npm test çıktısı; durum eşleme tablosu; test sırasında unmapped_values'a düşen değerler.