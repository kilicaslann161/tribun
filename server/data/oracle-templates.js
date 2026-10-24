/**
 * Tribün — Kâhin şablonları (sunucu tarafı, kaynak doğruluk)
 * Aynı takım çifti + aynı gün → aynı tahmin (seed'li rastgelelik).
 * {home} ve {away} yer tutucuları sunucu tarafından doldurulur.
 */
const COMMENTS = [
  '{home} soyunma odasında mangal yakmış geliyor, {away} daha otobüsten inmedi.',
  'Top {away} yarı sahasında 40 dakika misafir kalacak; misafirperverlik sınırı aşılacak.',
  '{home} kalecisi bugün eldivenlerini ters giymiş, bir tık şanslı görünüyor.',
  'İlk yarı ısınma, ikinci yarısı show. {away} savunması bu show\'un figüranı olacak.',
  '{away} teknik direktörü çizgide o kadar koşacak ki maç sonunda kendisine sarı kart görünecek.',
  'Küre titredi: {away} 80. dakikaya kadar direnecek, 81\'de direkler teslim olacak.',
  '{home} kanat oyuncusu bugün çimleri sulayacak, topu değil.',
  'Kristal küre diyor ki: {home} tribününü ikinci yarıda eskitecek bir gol var.',
  'Kötü haber {away} için: deplasman yolunda lastik patladı, metaforik olarak.',
  '{home} orta sahası bugün pas trafiğini yönetecek; ehliyeti yeni aldı ama kullanıyor.',
  '{away} forveti golü atacak ama formayı çıkarınca sarı kart görünecek. Küre böyle dedi, inanmamak serbest.',
  'Bu maçta bir penaltı çıkacak ama tartışmalı. Hakem kendine güveniyor, küre etmiyor.',
  '{home} tribünü bugün o kadar gürültü yapacak ki {away} teknik direktörü telefonla anlaşacak.',
  'Kürenin buğusu dağıldı: {away} ikinci yarıda yorgun düşecek, mola verilmeyecek.',
  '{home} köşe vuruşlarında tehlikeli; {away} korner bayrağını sökmeyi düşünüyor.',
  'Maç sonrası {home} taraftarı meşaleyle kutlama yapacak, itfaiye marş dinleyecek.',
  '{away} bugün savunmada beş kişi oynayacak; altıncısı kaleci, yedincisi şans.',
  'Küre diyor ki bu maç berabere biterse kimse şaşırmayacak; şaşıran yalnızca küre olacak.',
  '{home} 10. dakikada golü bulacak, sonra 80 dakika topu üçgen pasla taşıyacak.',
  '{away} deplasman tribünü coşacak; ev sahibi kulüp "ses sistemi bozuk" diyecek.',
  'Bugün {home} için her şey yolunda: çimler keskin, rüzgâr arkadan, kaleci uyanık.',
  '{away} maçın adamını kaçıracak ama transfer listesinde tutacak. Küre transfer sezonunu da görüyor.',
  'İkinci yarının ilk 10 dakikası kaos, son 5 dakikası {home} için alkış.',
  'Kürenin içinden bir ses: {away} kanat oyuncusu bugün iki asist yapar; biri şans, biri maharet.',
  '{home} orta saha savaşını kazanacak; savaş meydanı biraz çamur olacak.',
  'Maç başlamadan {away} taraftarı "kazanacağız" diyor. Küre gülümsedi, sadece gülümsedi.',
  '{home} bugün kontra atakla gol arayacak; kontra çayını da ikram edecek.',
  '{away} savunması hata yapacak; hatayı izleyen tribün fısıldayacak: "biz demiştik".',
  'Küre berraklaştı: maçın kritik anı 67. dakika. Kimse tuvalete gitmesin.',
  '{home} forveti ilk yarışta dike takılacak, ikinci yarı diği sökecek.',
  'İki takım da kazanmak istiyor ama küre sadece birine güldü. Diğerine "geçmiş olsun" dedi.',
  '{away} kalecisi bugün fotoğraf çektirmeye geldiyse çok iyi fotoğraflar çıkacak.',
  'Maç rüzgârlı olacak; top bir kez yalanacak, o da {home} yararına.',
  '{home} tribünü 90 dakika tezahürat yapacak, 91. dakikada boğaz pastili dağıtacak.',
  'Kürenin son sözü: {away} bu maçta ders alacak; dersi "sabırla savunma" konulu.',
  '{home} erken golü bulursa maç açılır; geç bulursa {away} otobüsü kapıya çeker.',
  'Bugün hakemin düdüğü sıcak, kartlar cepte terleyecek.',
  '{away} teknik direktörü son dakikada üç oyuncu birden değiştirecek; biri ısınmadan dönmemiş olacak.',
  'Küre maçı {home} lehine görüyor. Ama {away} bir gol atarsa küre hesabı yeniden yapacak; bu sefer ücretsiz.',
  'Maç sonunda üç puan {home}\'ın olur, {away} üç gün hakeme takılır. Klasik.',
  '{home} ile {away} arasındaki bu maç tarihe geçecek; geçtiği yer: mahalle tezahürat kulübü panosu.',
  'Küre yorgun, son tahmin: {home} kazanır, {away} tarafı itiraz eder. Yine klasik.'
];

const SCORES = ['1-0', '2-0', '3-1', '2-2', '1-1', '0-0', '4-2', '1-3', '2-1', '0-2', '3-0', '1-2'];

const RED_CARDS = [0, 0, 0, 1, 1, 2];

const CONTROVERSIES = [
  '78. dakikada verilmeyen net penaltı',
  'Taç çizgisinden çalınan gol',
  'Ofsayt bayrağı üç dakika sonra kalktı',
  'El mi topsa mı tartışması (tam dört kez)',
  'Kaleci zaman geçirirken gördüğü sarı kart',
  'İkinci yarının 4 dakika uzatması (kimse anlamadı)',
  'Direkten dönen topun çizgiyi geçip geçmediği',
  'Yedek kulübesinden atılan içecek şişesi',
  'Rakip teknik direktörün sahaya top yuvarlaması',
  'VAR odasından gelen "devam" kararı (itirazlar reddedildi)',
  'Frikik duvarının 9.15 metre tartışması',
  'Korner sayısının yanlış sayılması'
];

const MOTM = [
  'Kaleci — üç net kurtarış, bir de penaltı',
  'Sol bek — bir gol bir asist, alkış tribünden',
  'Yedekten giren forvet — 12 dakikada iki gol',
  'Orta saha kaptanı — 11 km koştu, topu hiç bırakmadı',
  '18\'lik genç yetenek — ilk maçında gol, annesi tribünde ağlıyor',
  'Stoper — kafa toplarının hepsini kazandı',
  'Sağ kanat — rakibi twister oynatır gibi döndürdü',
  'Defansif orta saha — 14 top kapması var, tertemiz',
  'Frikik ustası — duvarın üstünden aşırttı',
  'İkinci kaleci — 63. dakikada girdi, maçın adamı çıktı',
  'Forvet — gol atamadı ama iki asist; aç gözlü değil',
  'Oyun kurucu — 94 isabetli pas, dokuz metreye'
];

module.exports = { COMMENTS, SCORES, RED_CARDS, CONTROVERSIES, MOTM };
