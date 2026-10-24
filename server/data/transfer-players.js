/**
 * Tribün — Hayali Transfer oyuncu havuzu (50 TAMAMEN UYDURMA oyuncu)
 * Gerçek kişi, takım veya lig yoktur; benzerlikler tamamen tesadüftür.
 * Dağılım: 5 KL, 15 DF, 15 OS, 15 FV · Güç 60-95, fiyat milyon € (M)
 */
const PLAYERS = [
  // ---- Kaleciler (5) ----
  { name: 'Selim Duran', pos: 'KL', power: 88, price: 28, trait: 'Penaltı korkusu tanımaz' },
  { name: 'Marco Bellini', pos: 'KL', power: 82, price: 18, trait: 'Çizgi hâkimi; topu rakip bile kıskanır' },
  { name: 'Umut Sarıkaya', pos: 'KL', power: 76, price: 11, trait: 'Uzun topları roket gibi dağıtır' },
  { name: 'Jonas Kelder', pos: 'KL', power: 70, price: 6, trait: 'Fil gibi sakin; panik nedir bilmez' },
  { name: 'Yiğit Abalıoğlu', pos: 'KL', power: 64, price: 3, trait: 'Genç ve heyecanlı; bir gün efsane' },

  // ---- Defans (15) ----
  { name: 'Dragan Mitkov', pos: 'DF', power: 91, price: 35, trait: 'Beton savunmanın harç kâriysi' },
  { name: 'Kaan Erdemsoy', pos: 'DF', power: 87, price: 24, trait: 'Son anda ayak atan adam' },
  { name: 'Rafael Santez', pos: 'DF', power: 85, price: 21, trait: 'Kanatları kilitler, anahtarını yutar' },
  { name: 'Petro Slavov', pos: 'DF', power: 83, price: 17, trait: 'Hava toplarının tek sahibi' },
  { name: 'Tolga Balcı', pos: 'DF', power: 80, price: 14, trait: 'Temiz savunur, kart görmez' },
  { name: 'Emil Norrback', pos: 'DF', power: 78, price: 12, trait: 'İskandinav soğukkanlılığı' },
  { name: 'Hakan Çimenci', pos: 'DF', power: 75, price: 9, trait: 'Yorulmak nedir bilmez' },
  { name: 'Bruno Cavalho', pos: 'DF', power: 73, price: 8, trait: 'Öne kat eden modern bek' },
  { name: 'Serkan Ayanoğlu', pos: 'DF', power: 71, price: 6, trait: 'Yerden oyunun sadık dostu' },
  { name: 'Ivan Petrin', pos: 'DF', power: 69, price: 5, trait: 'Tecrübeli; sakatlık kelimesini sevmiyor' },
  { name: 'Mert Kılıçaslan', pos: 'DF', power: 67, price: 4, trait: 'Genç yetenek, hızlı öğrenir' },
  { name: 'Andreas Lindqvist', pos: 'DF', power: 65, price: 3, trait: 'Sessiz ama etkili' },
  { name: 'Ali Rızvan', pos: 'DF', power: 66, price: 3.5, trait: 'Müdahaleleri cerrah hassasiyetinde' },
  { name: 'Cem Yörük', pos: 'DF', power: 63, price: 2.5, trait: 'Az hata yapar, çok koşar' },
  { name: 'Barış Toprak', pos: 'DF', power: 62, price: 2, trait: 'Kalesi önünde duvar örter' },

  // ---- Orta Saha (15) ----
  { name: 'Mateus Andrade', pos: 'OS', power: 93, price: 38, trait: 'Orta sahanın maestrosu' },
  { name: 'Arda Şahinkaya', pos: 'OS', power: 90, price: 30, trait: 'Sola çalıp sağdan geçer' },
  { name: 'Luca Ferrante', pos: 'OS', power: 88, price: 26, trait: 'Pas trafiğinin şefi' },
  { name: 'Yusuf Kandemir', pos: 'OS', power: 86, price: 22, trait: 'Kontranın start düğmesi' },
  { name: 'Nikola Vrban', pos: 'OS', power: 84, price: 19, trait: 'Uzaktan şut ustası' },
  { name: 'Emre Şahin', pos: 'OS', power: 81, price: 15, trait: 'Duran topların yıldızı' },
  { name: 'Diego Ramalle', pos: 'OS', power: 79, price: 13, trait: 'Rakibi döndüre döndüre oynatır' },
  { name: 'Okan Bilgin', pos: 'OS', power: 77, price: 10, trait: 'Boksör gibi pres yapar' },
  { name: 'Stefan Djuric', pos: 'OS', power: 74, price: 8.5, trait: 'Dengeli, ağırbaşlı, güvenilir' },
  { name: 'Berat Günebakan', pos: 'OS', power: 72, price: 7, trait: 'İkinci topların avcısı' },
  { name: 'Piet Verhoeven', pos: 'OS', power: 70, price: 5.5, trait: 'Frikik meraklısı' },
  { name: 'Sinan Karabulut', pos: 'OS', power: 68, price: 4.5, trait: 'Kanat ortalarında tehlike' },
  { name: 'Tarik Osmanoğlu', pos: 'OS', power: 66, price: 3.5, trait: 'Basit oynar, iş bitirir' },
  { name: 'Levent Aksu', pos: 'OS', power: 64, price: 3, trait: 'Tribün sevgisini sahaya taşır' },
  { name: 'Onur Şenses', pos: 'OS', power: 62, price: 2.5, trait: 'Sessiz kanat çalışanı' },

  // ---- Forvet (15) ----
  { name: 'Aleks Vujic', pos: 'FV', power: 95, price: 40, trait: 'Dokunduğu top ağlarla konuşur' },
  { name: 'Diego Falcao', pos: 'FV', power: 92, price: 34, trait: 'Ceza sahasında tilki' },
  { name: 'Kerem Ateşli', pos: 'FV', power: 89, price: 27, trait: 'Kafasıyla gol atar, elle yemek yer' },
  { name: 'Mario Salvetti', pos: 'FV', power: 87, price: 23, trait: 'Bitiriciliği elmas gibi' },
  { name: 'Efe Tanrıverdi', pos: 'FV', power: 85, price: 20, trait: 'Sol ayağı fırça darbesi' },
  { name: 'Samir Hasanov', pos: 'FV', power: 83, price: 18, trait: 'İlk dokunuşta gol kokusu' },
  { name: 'Batırhan Ölmez', pos: 'FV', power: 81, price: 15, trait: 'Kayarak da olsa bitirir' },
  { name: 'Hugo Bastien', pos: 'FV', power: 79, price: 12.5, trait: 'Fizik gücüyle ezber bozar' },
  { name: 'Anıl Çelik', pos: 'FV', power: 77, price: 10, trait: 'Frikiklerden gol toplar' },
  { name: 'Dario Knez', pos: 'FV', power: 75, price: 9, trait: 'Doğru yerde durmayı bilir' },
  { name: 'Uğur Denizkıran', pos: 'FV', power: 73, price: 7, trait: 'Hızlı, aç ve gol düşkünü' },
  { name: 'Milan Horvat', pos: 'FV', power: 71, price: 5.5, trait: 'Uzun boydan kafa golleri' },
  { name: 'Tuna Barutçu', pos: 'FV', power: 69, price: 4.5, trait: 'Gece maçlarında parlar' },
  { name: 'Ercan Yolcu', pos: 'FV', power: 67, price: 3.5, trait: 'Kaybettikçe daha çok koşar' },
  { name: 'Bilge Topaloğlu', pos: 'FV', power: 65, price: 3, trait: 'Gol attığında şiir okur gibi sevinir' }
];

module.exports = { TRANSFER_PLAYERS: PLAYERS };
