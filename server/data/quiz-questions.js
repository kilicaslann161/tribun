/**
 * Tribün — Taraftar Testi: sorular, seçenek→tip eşlemesi ve tip meta bilgileri
 * SUNUCU TARAFI KAYNAK DOĞRULUKTUR. public/js/data/quiz-questions.js dosyasındaki
 * soru/seçenek metinleri burayla birebir aynı sırada tutulmalıdır.
 *
 * Tipler: direktor, sair, analizci, bayrak, corap
 */
const FAN_TYPES = {
  direktor: {
    key: 'direktor',
    name: 'Sabırsız Teknik Direktör',
    emoji: '😤',
    desc: 'Yanlış diziliş gördüğünde tırnakların acıyor. Maçı değil, teknik direktörü izliyorsun; 3. dakikada "şu adamı çıkar" diyorsun. Ailende kimse seninle maç izlemek istemiyor çünkü 90 dakika taktik anlatıyorsun. Unvanın: parmak emmiş, tahtaya yazmış.'
  },
  sair: {
    key: 'sair',
    name: 'Tribün Şairi',
    emoji: '🪶',
    desc: 'Senin için maç bir destan, tribün bir sahne. 90 dakikanın 80\'inde tezahürat, 10 dakikasında gözyaşı var. Kaybedilen maçların bile şiiri sende bitiyor. Rakip de olsa seni alkışlatmayı başarıyorsun.'
  },
  analizci: {
    key: 'analizci',
    name: 'Sessiz Analizci',
    emoji: '🧐',
    desc: 'Konuşmazsın, not alırsın. Kimse fark etmez ama sen ilk yarıdaki pas hatasını da kalecinin adım uzunluğunu da biliyorsun. Maç sonu "ben demiştim" demezsin; not defterin söyler. Tribünün sessiz istihbaratçısı sensin.'
  },
  bayrak: {
    key: 'bayrak',
    name: 'Bayrak Taşıyıcı',
    emoji: '🚩',
    desc: 'Bayrak sende, marş sende, yangın sende. Sesin 90 dakika hiç kesilmiyor; boğazın maç sonrası kayboluyor ama umursamıyorsun. Deplasman yolu senin için hac yolculuğu. Takımın 12. oyuncusu sensin.'
  },
  corap: {
    key: 'corap',
    name: 'Şanslı Çorap Sahibi',
    emoji: '🧦',
    desc: 'Her maç aynı çorap, her maç aynı koltuk; bir tanesi ters. Şampiyonluk sezonunda giydiğin atkı hâlâ askıda, dokunulmaz. Batıl inanç senin için taktik, uğur senin için formül. İstatistiklere değil, içsel sesine güvenirsin.'
  }
};

// Beraberlikte öncelik sırası (deterministik sonuç için)
const QUIZ_TYPE_PRIORITY = ['sair', 'analizci', 'direktor', 'bayrak', 'corap'];

const QUIZ_QUESTIONS = [
  {
    q: 'Maç son dakikaya kala 1-0 gerideyiz, teknik direktör seni ısınmaya çağırdı. Ne yaparsın?',
    options: [
      { t: 'Koşarak çıkarım, forma yarısı içeri; "bana atın her topu!" derim', type: 'direktor' },
      { t: 'Isınmaya giderim ama önce tribüne selam veririm; bu anın şiiri bende kalacak', type: 'sair' },
      { t: 'Rakibin son 10 dakikadaki yüksek pres düzenini kafamda kurup boş alana koşarım', type: 'analizci' },
      { t: 'Ayakkabı bağcıklarımı yedi kez bağlarım, uğur böyle gelir', type: 'corap' }
    ]
  },
  {
    q: 'Hakem net penaltı vermedi, top elle kesildi. İlk tepkin ne?',
    options: [
      { t: 'Tribünü ayağa kaldırırım; itiraz koro hâlinde, hep bir ağızdan!', type: 'bayrak' },
      { t: 'O anın acısını içime gömer, maç sonu destanına bir dörtlük eklerim', type: 'sair' },
      { t: 'Pozisyonu zihnimde tekrar oynatırım; temas noktası ceza sahası içi mi, ölçerim', type: 'analizci' },
      { t: 'Çizgiye kadar koşup "VAR\'a bak!" diye bağırırım; kart riskini göze alırım', type: 'direktor' }
    ]
  },
  {
    q: 'Takım 3-0 önde, 88. dakika, rakip baskıda. Sana göre ne yapmalı?',
    options: [
      { t: 'Herkes savunmaya, ben yine de forvetin yanında kalırım; kontra anı gelebilir', type: 'direktor' },
      { t: 'Tezahüratı "onurunuzla savunun" moduna çeviririm, 90 dakika susmam', type: 'bayrak' },
      { t: 'Rakibin kanat oyuncusunun içe kat etme oranına göre bölge kaydırması yapılmalı', type: 'analizci' },
      { t: 'Aynı pozisyonda oturmaya devam; 88\'de kalkarsak gol yeriz, deneyim konuşuyor', type: 'corap' }
    ]
  },
  {
    q: 'Deplasman maçı, otobüs arıza yaptı, maça 2 dakika kala yetiştiniz. İlk işin?',
    options: [
      { t: 'Direkt sahaya fırlarım, ısınmayı tanımam; diziliş değişikliğini ben söylerim', type: 'direktor' },
      { t: 'Yolda maç marşı bestelemiştim, stadyuma girer girmez mırıldanmaya başlarım', type: 'sair' },
      { t: 'Yetişme planını kafamda kurarım: hangi koridordan girsek daha hızlı olur?', type: 'analizci' },
      { t: 'Otobüsteki koltuk numaramı maç biletimin arkasına yazarım; şans tamam', type: 'corap' }
    ]
  },
  {
    q: 'Uzak bir frikik kazandınız, top ağır. Kim başına geçmeli?',
    options: [
      { t: 'Ben! Direğin dibine vururum; olmazsa da en azından duvarı korkuturum', type: 'direktor' },
      { t: 'Topun süzülüşünü izler, o güzelliği sonra kelimelere dökerim', type: 'sair' },
      { t: 'Kalecinin adım genişliğine ve duvar hizasına göre köşe seçilir, hesap işi', type: 'analizci' },
      { t: 'Geçen sezonki frikik golünün ardından giydiğim çoraplar var; onlar giyilmeli', type: 'corap' }
    ]
  },
  {
    q: 'Derbi sabahı uyandın. İlk işin ne?',
    options: [
      { t: 'Dünkü rakip maçın hata videosunu açarım, mutfakta taktik tahtası kurarım', type: 'direktor' },
      { t: 'Tribün grubunun yeni tezahüratını son kez provaya çıkarırım', type: 'bayrak' },
      { t: 'İki takımın son 5 maç istatistiğine bakarım, not alırım', type: 'analizci' },
      { t: 'Şampiyonluk sezonunda giydiğim o kıyafeti hazırlarım; dokunulmaz', type: 'corap' }
    ]
  },
  {
    q: 'Takımın 18\'lik gençi ilk maçında gol attı! Tepkin?',
    options: [
      { t: 'Hemen adına tezahürat bestelerim; tribün 10 dakika susmaz', type: 'bayrak' },
      { t: 'Bu çocuğun hikâyesini destanlaştırırım; ölür de torunlarıma anlatırım', type: 'sair' },
      { t: 'Altyapı istatistiklerine bakarım; bu patlama bekleniyordu, veriler ortada', type: 'analizci' },
      { t: 'Golü attığı dakikayı ve forma numarasını not ederim; uğur sayılır', type: 'corap' }
    ]
  },
  {
    q: 'Maç yağmurda oynanacak, çimler ağır. Taktik ne olmalı?',
    options: [
      { t: 'Hücumu basitleştir: uzun top, ikinci toplar, kanattan ortalar!', type: 'direktor' },
      { t: 'Çamurun adı efsanedir; bu maçın şiiri zaten yazıldı', type: 'sair' },
      { t: 'Pas trafiği yarıya iner, kanat oyuncuları geniş alan kullanır', type: 'analizci' },
      { t: 'Şemsiyemi ters tutarım; rüzgâr gol getirir, bir kere getirdi', type: 'corap' }
    ]
  },
  {
    q: '90+4, skor 1-1 ve son kornerimiz. Sen ne dersen?',
    options: [
      { t: 'Kaleci de gelsin! Herkes rakip ceza sahasında, top gelsin!', type: 'direktor' },
      { t: 'Korner tezahüratı! Stat ayakta, komut benden', type: 'bayrak' },
      { t: 'Kısa korner riskli; ortayı bekle, ikinci topa hazır ol', type: 'analizci' },
      { t: 'Bu dakikada güvendiğim şey var: 3 yıldır aynı sıradayım', type: 'corap' }
    ]
  },
  {
    q: 'Sezon bitti, takım şampiyon! Sokakta kutlama...',
    options: [
      { t: 'Kortege en önde, bayrak bende; sesim gidene kadar bağırırım', type: 'bayrak' },
      { t: 'Şiiri çoktan yazdım; meydanda ilk okuyan ben olacağım', type: 'sair' },
      { t: 'Şampiyonluğun matematiksel seyrini özetleyen bir yazı hazırlarım', type: 'analizci' },
      { t: 'O sezon giydiğim atkıyı çerçeveletirim; artık müze eseri', type: 'corap' }
    ]
  }
];

module.exports = { FAN_TYPES, QUIZ_TYPE_PRIORITY, QUIZ_QUESTIONS };
