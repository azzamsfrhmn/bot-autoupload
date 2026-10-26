/**
 * src/utils/captionSanitizer.js
 * Modul sensor kata kunci sensitif brand dan pembentuk caption ramah algoritma TikTok
 */

// Kamus penyamaran kata kunci brand sensitif
const BRAND_REPLACEMENTS = [
  { pattern: /\b(spotify|spotipay|spotipai)\b/gi, replacement: 'aplikasi musik hijau' },
  { pattern: /\b(netflix|netflik)\b/gi, replacement: 'aplikasi nonton film merah' },
  { pattern: /\b(canva|kanva)\b/gi, replacement: 'aplikasi desain grafis' },
  { pattern: /\b(capcut|cap cut|kepkut)\b/gi, replacement: 'aplikasi edit video' },
  { pattern: /\b(youtube premium|yt premium)\b/gi, replacement: 'aplikasi video tanpa iklan' },
  { pattern: /\b(disney\+?|disney hotstar)\b/gi, replacement: 'aplikasi nonton film biru' },
  { pattern: /\b(jual|beli|murah|order|wa|whatsapp)\b/gi, replacement: 'dapetin' } // Hindari kata hard-selling ekstrem
];

/**
 * Samarkan brand sensitif agar aman dari filter komunitas TikTok
 */
function sanitizeBrandKeywords(rawText) {
  if (!rawText) return '';
  let cleaned = rawText;
  for (const item of BRAND_REPLACEMENTS) {
    cleaned = cleaned.replace(item.pattern, item.replacement);
  }
  return cleaned;
}

/**
 * Buat struktur caption lengkap yang memicu interaksi (Hook + Benefit + CTA + Hashtag FYP)
 */
function generateFypCaption({ topic = 'musik', customCaption = '' }) {
  if (customCaption) {
    const safeCustom = sanitizeBrandKeywords(customCaption);
    return `${safeCustom}\n\nKira-kira fitur apa lagi yang wajib dicoba? Tulis di komentar ya! 👇\n#serunyabelajar #tipsandtricks #rekomendasi #fyp #viral`;
  }

  const templates = {
    musik: `Dengerin lagu favorit bebas jeda iklan bikin mood seharian makin naik! 🎧✨ Sekarang nikmatin playlist di aplikasi musik makin praktis dan nyaman.\n\nLagu apa nih yang lagi sering kalian putar akhir-akhir ini? Tulis di komen ya! 👇\n#aplikasimusik #playlistlagu #moodbooster #tipsbermanfaat #fypシ`,
    edit_video: `Bikin konten estetik nggak perlu ribet lagi! Pakai template di aplikasi edit video bikin hasil editan rapi dan sat-set selesai dalam hitungan detik. 🎬🔥\n\nKalian lebih suka edit manual atau pakai template instan nih? 👇\n#editvideo #tutorialedit #kontenkreator #videoviral #fyp`,
    desain: `Bikin banner dan presentasi rapi sekarang makin gampang banget lewat aplikasi desain grafis! Banyak pilihan elemen premium yang siap pakai. 🎨✨\n\nCek inspirasi lainnya yuk! Mau dibikinin tips apa lagi berikutnya? 👇\n#desainmudah #produktif #kontenkreator #desainhacks #fyp`
  };

  return templates[topic] || templates.musik;
}

module.exports = {
  sanitizeBrandKeywords,
  generateFypCaption
};