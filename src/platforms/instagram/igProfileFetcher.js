/**
 * Ambil data profil Instagram lengkap (profil, statistik, foto, 12 postingan terakhir)
 * lewat API web Instagram dari dalam halaman instagram.com yang sudah login.
 */
const { chromium } = require('playwright');

const IG_APP_ID = '936619743392459';

async function toDataUrl(url) {
  if (!url || !/^https?:/.test(url)) return url || '';
  try {
    const r = await fetch(url, { headers: { Referer: 'https://www.instagram.com/' } });
    if (!r.ok) return url;
    return `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch (e) {
    return url;
  }
}

// Angka "1,234" / "1.2K" / "3,5 rb" / "2M" → number
function parseCount(t) {
  const m = String(t || '').trim().match(/^([\d.,]+)\s*([kKmMbB]|rb|jt)?/);
  if (!m) return 0;
  let num = m[1];
  const suf = (m[2] || '').toLowerCase();
  if (suf) num = num.replace(',', '.'); else num = num.replace(/[.,]/g, '');
  const mult = { k: 1e3, rb: 1e3, m: 1e6, jt: 1e6, b: 1e9 }[suf] || 1;
  return Math.round(parseFloat(num) * mult) || 0;
}

// page: halaman Playwright yang sudah login Instagram. Data diambil dari halaman profil (DOM),
// karena API web Instagram sering menolak (429/404) untuk browser otomatis.
async function fetchProfileInPage(page) {
  // 1. Username akun yang login: tautan "Profile" di menu samping
  if (!/instagram\.com/.test(page.url())) {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  }
  await page.waitForSelector('a[href^="/"] img, nav, [role="navigation"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const username = await page.evaluate(() => {
    const SKIP = /^\/(reels|explore|popular|direct|accounts|stories|p|reel|about|legal|developer|web|emails?|challenge)\b/;
    const anchors = Array.from(document.querySelectorAll('a[href^="/"]'));
    const byText = anchors.find((a) => /^(profile|profil)$/i.test((a.innerText || '').trim()) || /profile|profil/i.test(a.querySelector('img')?.alt || ''));
    const cand = byText ? byText.getAttribute('href') : (anchors.map((a) => a.getAttribute('href')).find((h) => /^\/[A-Za-z0-9._]+\/$/.test(h) && !SKIP.test(h)) || '');
    return (cand || '').replace(/\//g, '');
  }).catch(() => '');
  if (!username) return null;

  // 2. Halaman profil
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await page.waitForSelector('header', { timeout: 30000 }).catch(() => {});
  // Internet lambat: tunggu sampai angka statistik (followers) & grid postingan benar-benar tampil
  await page.waitForFunction(() => /[\d.,]+\s*[KkMm]?\s*(followers?|pengikut)/i.test((document.querySelector('header')?.innerText || '').replace(/\s+/g, ' ')), null, { timeout: 45000 }).catch(() => {});
  await page.waitForSelector('main a[href*="/p/"] img, main a[href*="/reel/"] img', { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => Array.from(document.querySelectorAll('main a[href*="/p/"] img, main a[href*="/reel/"] img, header img')).every((i) => i.complete), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const raw = await page.evaluate(() => {
    const og = document.querySelector('meta[property="og:description"]')?.content || '';
    const header = document.querySelector('header');
    const lines = header ? header.innerText.split('\n').map((l) => l.trim()).filter(Boolean) : [];
    const avatar = header?.querySelector('img')?.src || '';
    const seen = new Set();
    const posts = [];
    document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const code = href.split('/').filter(Boolean).pop();
      const img = a.querySelector('img');
      if (!code || seen.has(code) || !img) return;
      seen.add(code);
      posts.push({ id: code, shortcode: code, imageUrl: img.currentSrc || img.src || '', isVideo: href.includes('/reel/'), likeCount: 0, commentCount: 0, caption: img.alt || '' });
    });
    return { og, lines, avatar, posts: posts.slice(0, 12), url: location.href };
  }).catch(() => null);
  if (!raw) return null;

  // og:description: "569 Followers, 10 Following, 94 Posts - See Instagram photos and videos from NAMA (@user)"
  const ogM = raw.og.match(/^([\d.,]+\s*[KkMm]?)\s+Followers?,\s*([\d.,]+\s*[KkMm]?)\s+Following,\s*([\d.,]+\s*[KkMm]?)\s+Posts?/i);
  const nameM = raw.og.match(/from\s+(.+?)\s+\(@/i);
  // Angka & label bisa beda baris ("46" / "followers") → cari di teks header yang digabung
  const flat = raw.lines.join(' ');
  const statOf = (label) => { const m = flat.match(new RegExp(`([\\d.,]+\\s*(?:[KkMm]|rb|jt)?)\\s*(?:${label})\\b`, 'i')); return m ? parseCount(m[1]) : 0; };
  // Angka di header profil = yang dilihat pengguna. og:description sering basi (mis. "0 Followers") → hanya cadangan.
  const hasHeaderStats = /[\d.,]+\s*[KkMm]?\s*(followers?|pengikut)/i.test(flat);
  let followersCount = hasHeaderStats ? statOf('followers?|pengikut') : (ogM ? parseCount(ogM[1]) : 0);
  let followingCount = hasHeaderStats ? statOf('following|diikuti|mengikuti') : (ogM ? parseCount(ogM[2]) : 0);
  let postsCount = hasHeaderStats ? statOf('posts?|postingan|kiriman') : (ogM ? parseCount(ogM[3]) : 0);

  // Like & komentar: tampil di kartu grid saat diarahkan mouse (angka like lalu komentar)
  const grid = page.locator('main a[href*="/p/"], main a[href*="/reel/"]');
  const nGrid = Math.min(12, await grid.count().catch(() => 0));
  for (let i = 0; i < nGrid; i++) {
    const a = grid.nth(i);
    await a.hover({ timeout: 5000 }).catch(() => {});
    let info = null;
    for (let t = 0; t < 6 && !info; t++) {
      await page.waitForTimeout(400);
      info = await a.evaluate((e) => {
        const nums = (e.innerText || '').split('\n').map((x) => x.trim()).filter((x) => /^[\d.,]+\s*([KkMm]|rb|jt)?$/.test(x));
        return nums.length ? { code: (e.getAttribute('href') || '').split('/').filter(Boolean).pop(), nums } : null;
      }).catch(() => null);
    }
    const post = info && raw.posts.find((p) => p.shortcode === info.code);
    if (post) { post.likeCount = parseCount(info.nums[0]); post.commentCount = parseCount(info.nums[1] || '0'); }
  }
  await page.mouse.move(5, 5).catch(() => {});

  // Views: tab Reels (angka ditonton di tiap kartu reel)
  if (raw.posts.some((p) => p.isVideo)) {
    const tab = page.locator(`a[href="/${username}/reels/"]`).first();
    if (await tab.isVisible({ timeout: 10000 }).catch(() => false)) {
      await tab.click().catch(() => {});
      await page.waitForFunction(() => /\/reels\/?$/.test(location.pathname)
        && Array.from(document.querySelectorAll('main a[href*="/reel/"]')).some((a) => /\d/.test(a.innerText || '')), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const views = await page.evaluate(() => Array.from(document.querySelectorAll('main a[href*="/reel/"]')).map((a) => {
        const nums = (a.innerText || '').split('\n').map((x) => x.trim()).filter((x) => /^[\d.,]+\s*([KkMm]|rb|jt)?$/.test(x));
        return { code: (a.getAttribute('href') || '').split('/').filter(Boolean).pop(), v: nums[nums.length - 1] || '' };
      })).catch(() => []);
      for (const v of views) {
        const post = raw.posts.find((p) => p.shortcode === v.code);
        if (post && v.v) post.viewsCount = parseCount(v.v);
      }
    }
  }
  const api = null;
  postsCount = Math.max(postsCount, raw.posts.length);

  // Bio: baris setelah statistik sampai tombol aksi
  const iFollowing = raw.lines.findIndex((l) => /^[\d.,]+\s*[KkMm]?\s*(following|diikuti|mengikuti)/i.test(l));
  const STOP = /^(edit profile|edit profil|view archive|lihat arsip|follow|ikuti|message|kirim pesan|following|new|baru|share profile)$/i;
  const fullName = nameM ? nameM[1].trim() : '';
  const bioLines = [];
  for (let i = iFollowing + 1; i > 0 && i < raw.lines.length; i++) {
    if (STOP.test(raw.lines[i])) break;
    bioLines.push(raw.lines[i]);
  }
  const externalUrl = (bioLines.find((l) => /^(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}\/)/i.test(l)) || '').replace(/\s+and\s+\d+\s+more$/i, '');

  const data = {
    username,
    fullName: api?.fullName || fullName,
    biography: api?.bio ?? bioLines.join('\n'),
    externalUrl: api?.link || externalUrl,
    category: 'AKUN BISNIS / KREATOR',
    followersCount,
    followingCount,
    postsCount,
    avatarUrl: raw.avatar,
    posts: raw.posts
  };
  data.avatar = await toDataUrl(data.avatarUrl);
  for (const p of data.posts) p.imageUrl = await toDataUrl(p.imageUrl);
  return data;
}

// Chrome tersembunyi + cookie sesi tersimpan → data profil (untuk Refresh Profil / perbaikan akun lama)
async function fetchInstagramProfileWithCookies(cookies, chromePath) {
  const uid = (cookies.find((c) => c.name === 'ds_user_id') || {}).value;
  if (!uid) return null;
  let browser = null;
  try {
    // Jendela di luar layar (headless sering ditolak Instagram)
    browser = await chromium.launch({
      headless: false,
      ...(chromePath ? { executablePath: chromePath } : { channel: 'chrome' }),
      args: ['--disable-blink-features=AutomationControlled', '--window-position=-32000,-32000', '--hide-crash-restore-bubble']
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies(cookies.filter((c) => c.name && c.value && c.domain).map((c) => ({
      name: c.name, value: String(c.value), domain: c.domain, path: c.path || '/',
      secure: c.secure !== false, httpOnly: Boolean(c.httpOnly),
      sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'None',
      ...(Number(c.expires || c.expirationDate) > 0 ? { expires: Number(c.expires || c.expirationDate) } : {})
    })));
    const page = await context.newPage();
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
    if (/accounts\/login/.test(page.url())) return null;
    return await fetchProfileInPage(page);
  } catch (e) {
    console.warn('[IG Profile] Gagal mengambil profil:', e.message);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { fetchProfileInPage, fetchInstagramProfileWithCookies, toDataUrl, parseCount };
