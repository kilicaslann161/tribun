/**
 * Tribün — Taraftar Testi verisi (İSTEMCİ tarafı)
 *
 * ⚠️ BU DOSYA MAKİNE TARAFINDAN ÜRETİLİR: scripts/sync-quiz-data.js
 * Soru/seçenek metinleri server/data/quiz-questions.js ile birebir aynıdır;
 * elle düzenleme yapmayın, düzenlemeyi sunucu dosyasında yapıp scripti çalıştırın.
 *
 * İstemci yalnızca soruları gösterir; tip hesabı SUNUCUDA yapılır
 * (POST /api/games/quiz/submit → {answers: [seçenek indeksi x10]}).
 */

export const QUIZ = [
  {
    "q": "Maç son dakikaya kala 1-0 gerideyiz, teknik direktör seni ısınmaya çağırdı. Ne yaparsın?",
    "options": [
      "Koşarak çıkarım, forma yarısı içeri; \"bana atın her topu!\" derim",
      "Isınmaya giderim ama önce tribüne selam veririm; bu anın şiiri bende kalacak",
      "Rakibin son 10 dakikadaki yüksek pres düzenini kafamda kurup boş alana koşarım",
      "Ayakkabı bağcıklarımı yedi kez bağlarım, uğur böyle gelir"
    ]
  },
  {
    "q": "Hakem net penaltı vermedi, top elle kesildi. İlk tepkin ne?",
    "options": [
      "Tribünü ayağa kaldırırım; itiraz koro hâlinde, hep bir ağızdan!",
      "O anın acısını içime gömer, maç sonu destanına bir dörtlük eklerim",
      "Pozisyonu zihnimde tekrar oynatırım; temas noktası ceza sahası içi mi, ölçerim",
      "Çizgiye kadar koşup \"VAR'a bak!\" diye bağırırım; kart riskini göze alırım"
    ]
  },
  {
    "q": "Takım 3-0 önde, 88. dakika, rakip baskıda. Sana göre ne yapmalı?",
    "options": [
      "Herkes savunmaya, ben yine de forvetin yanında kalırım; kontra anı gelebilir",
      "Tezahüratı \"onurunuzla savunun\" moduna çeviririm, 90 dakika susmam",
      "Rakibin kanat oyuncusunun içe kat etme oranına göre bölge kaydırması yapılmalı",
      "Aynı pozisyonda oturmaya devam; 88'de kalkarsak gol yeriz, deneyim konuşuyor"
    ]
  },
  {
    "q": "Deplasman maçı, otobüs arıza yaptı, maça 2 dakika kala yetiştiniz. İlk işin?",
    "options": [
      "Direkt sahaya fırlarım, ısınmayı tanımam; diziliş değişikliğini ben söylerim",
      "Yolda maç marşı bestelemiştim, stadyuma girer girmez mırıldanmaya başlarım",
      "Yetişme planını kafamda kurarım: hangi koridordan girsek daha hızlı olur?",
      "Otobüsteki koltuk numaramı maç biletimin arkasına yazarım; şans tamam"
    ]
  },
  {
    "q": "Uzak bir frikik kazandınız, top ağır. Kim başına geçmeli?",
    "options": [
      "Ben! Direğin dibine vururum; olmazsa da en azından duvarı korkuturum",
      "Topun süzülüşünü izler, o güzelliği sonra kelimelere dökerim",
      "Kalecinin adım genişliğine ve duvar hizasına göre köşe seçilir, hesap işi",
      "Geçen sezonki frikik golünün ardından giydiğim çoraplar var; onlar giyilmeli"
    ]
  },
  {
    "q": "Derbi sabahı uyandın. İlk işin ne?",
    "options": [
      "Dünkü rakip maçın hata videosunu açarım, mutfakta taktik tahtası kurarım",
      "Tribün grubunun yeni tezahüratını son kez provaya çıkarırım",
      "İki takımın son 5 maç istatistiğine bakarım, not alırım",
      "Şampiyonluk sezonunda giydiğim o kıyafeti hazırlarım; dokunulmaz"
    ]
  },
  {
    "q": "Takımın 18'lik gençi ilk maçında gol attı! Tepkin?",
    "options": [
      "Hemen adına tezahürat bestelerim; tribün 10 dakika susmaz",
      "Bu çocuğun hikâyesini destanlaştırırım; ölür de torunlarıma anlatırım",
      "Altyapı istatistiklerine bakarım; bu patlama bekleniyordu, veriler ortada",
      "Golü attığı dakikayı ve forma numarasını not ederim; uğur sayılır"
    ]
  },
  {
    "q": "Maç yağmurda oynanacak, çimler ağır. Taktik ne olmalı?",
    "options": [
      "Hücumu basitleştir: uzun top, ikinci toplar, kanattan ortalar!",
      "Çamurun adı efsanedir; bu maçın şiiri zaten yazıldı",
      "Pas trafiği yarıya iner, kanat oyuncuları geniş alan kullanır",
      "Şemsiyemi ters tutarım; rüzgâr gol getirir, bir kere getirdi"
    ]
  },
  {
    "q": "90+4, skor 1-1 ve son kornerimiz. Sen ne dersen?",
    "options": [
      "Kaleci de gelsin! Herkes rakip ceza sahasında, top gelsin!",
      "Korner tezahüratı! Stat ayakta, komut benden",
      "Kısa korner riskli; ortayı bekle, ikinci topa hazır ol",
      "Bu dakikada güvendiğim şey var: 3 yıldır aynı sıradayım"
    ]
  },
  {
    "q": "Sezon bitti, takım şampiyon! Sokakta kutlama...",
    "options": [
      "Kortege en önde, bayrak bende; sesim gidene kadar bağırırım",
      "Şiiri çoktan yazdım; meydanda ilk okuyan ben olacağım",
      "Şampiyonluğun matematiksel seyrini özetleyen bir yazı hazırlarım",
      "O sezon giydiğim atkıyı çerçeveletirim; artık müze eseri"
    ]
  }
];
