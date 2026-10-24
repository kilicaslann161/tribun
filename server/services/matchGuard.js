/**
 * Tribün — maç upsert koruma kararları (AŞAMA 5; Aşama 3 kurallarının saf çekirdeği)
 *
 * Kararlar SAF fonksiyonlardır: DB'ye, ağa, zamana (now parametresi hariç) bağımlı
 * DEĞİLDİR → hem syncFixtures (fikstür işi) hem syncLive (canlı skor işi) aynı
 * çekirdeği kullanır; node:test doğrudan sınar. Kararların İŞLENMESİ (SQL yazımı)
 * syncFixtures'ın tek transaction'ında kalır.
 *
 * Kurallar (Aşama 3'ten aynen; Aşama 5'te geçerliliği KORUNUR):
 *   R1  NULL/boş yeni değer dolu skoru/alanı EZMEZ (SQL COALESCE — burada değil).
 *   R2  Durum geriye dönmez: finished → live/scheduled/unknown şüphelidir → ATLA.
 *   R3  Skor düşüşü şüphelidir; yalnız ARDIŞIK İKİ yanıtta aynı düşük değer
 *       görünürse KABUL edilir (VAR düzeltmesi senaryosu). pendingDrop haritası
 *       çağıran tarafından verilir — syncFixtures ve syncLive AYNI modül belleğini
 *       paylaşır, böylece iki işin gördüğü düşüşler tek hafızada birleşir.
 *   R4  finished + finished_at 24 saatten eski → KAYIT DONDURULMUŞ: hiçbir
 *       alan güncellenmez (Aşama 5 kuralı: "24 saat sonra kaydı dondur").
 *   R5  finished_at, durum finished'a İLK geçtiğinde yazılır (karar: shouldFinishAt).
 */

/* scheduled(0) < live/halftime(1) < finished(2). postponed/cancelled/suspended/
 * abandoned list normalizasyonunda ÜRETİLMEZ; gelirse yedek kural unknown üretir. */
const STATUS_RANK = { scheduled: 0, live: 1, halftime: 1, finished: 2 };

/** Dondurma eşiği: finished_at'tan itibaren 24 saat (Aşama 5). */
const FREEZE_AFTER_MS = 24 * 3600 * 1000;

/* ---------------- R2: durum geri dönüşü ---------------- */

/**
 * @param {string} oldStatus DB'deki durum
 * @param {string} newStatus yanıttan gelen (normalize edilmiş) durum
 * @returns {boolean} true → bu güncelleme ATLANMALI (şüpheli geri dönüş)
 */
function isStatusRollback(oldStatus, newStatus) {
  const o = STATUS_RANK[oldStatus];
  const n = STATUS_RANK[newStatus];

  // finished → bilinmeyen/olmayan sıra: bariz geri dönüş (koruma kuralı)
  if (oldStatus === 'finished' && n === undefined) return true;

  // İki sıra da biliniyorsa: sıra geri gitti mi? (ör. finished→live, live→scheduled)
  if (o !== undefined && n !== undefined && n < o) return true;

  // Mevcut durum sıra dışıysa (ör. 'postponed') kesin karar verilemez → koruma yok.
  // Bilinmeyen YENİ durum mevcut finished değilse: yedek normalizasyon zaten
  // 'unknown' üretir; finished dışında geri dönüş tehlikesi skor bozmaz.
  return false;
}

/* ---------------- R4: dondurma ---------------- */

/**
 * @param {{status:string, finished_at:string|null}} existing
 * @param {number} nowMs
 * @returns {boolean} true → kayıt donmuş, güncelleme ATLANMALI
 */
function isFrozen(existing, nowMs) {
  if (!existing || existing.status !== 'finished' || !existing.finished_at) return false;
  return nowMs - Date.parse(existing.finished_at) >= FREEZE_AFTER_MS;
}

/* ---------------- R3: skor düşüşü onayı ---------------- */

/**
 * Skor düşüşü denetimi. pendingDrop: Map<externalId, {home, away}> — çağıranın
 * (modülün) hafızası; aynı harita iki iş tarafından paylaşıldığı için onay
 * işleri arası tutarlıdır.
 *
 * @returns {{proceed:boolean, firstSeen?:boolean, confirmed?:boolean}}
 *   proceed=false → bu turda KABUL EDİLMEZ (ilk görülüş; pending'e yazıldı)
 *   proceed=true  → düşüş yok YA DA ardışık ikinci aynı düşük değer (confirmed)
 */
function checkScoreDrop(pendingDrop, externalId, incoming, existing) {
  const newHome = incoming ? incoming.home : null;
  const newAway = incoming ? incoming.away : null;
  const oldHome = existing ? existing.home : null;
  const oldAway = existing ? existing.away : null;

  const dropped =
    (newHome != null && oldHome != null && newHome < oldHome) ||
    (newAway != null && oldAway != null && newAway < oldAway);

  if (!dropped) {
    pendingDrop.delete(externalId); // düşüş yok → bekleyen şüphe temizlenir
    return { proceed: true };
  }

  const pend = pendingDrop.get(externalId);
  if (pend && pend.home === newHome && pend.away === newAway) {
    pendingDrop.delete(externalId);
    return { proceed: true, confirmed: true }; // ikinci aynı değer → kabul
  }
  pendingDrop.set(externalId, { home: newHome, away: newAway });
  return { proceed: false, firstSeen: true };   // ilk görülüş → atla
}

/* ---------------- R5: finished_at kararı ---------------- */

/** existing yoksa VE yeni durum finished'sa → ilk görülüşte finished_at yazılır */
function shouldSetFinishedAt(existing, newStatus) {
  if (existing && existing.status === 'finished') return false; // zaten finished
  return newStatus === 'finished';
}

module.exports = {
  STATUS_RANK,
  FREEZE_AFTER_MS,
  isStatusRollback,
  isFrozen,
  checkScoreDrop,
  shouldSetFinishedAt
};
