/**
 * Daftar Facebook Page yang dikelola akun Facebook (dibaca dari facebook.com/pages/?category=your_pages).
 */
async function toDataUrl(url) {
  if (!url || !/^https?:/.test(url)) return url || '';
  try {
    const r = await fetch(url, { headers: { Referer: 'https://www.facebook.com/' } });
    if (!r.ok) return url;
    return `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch (e) {
    return url;
  }
}

// page: halaman Playwright pada profil Chrome akun Facebook (sudah login)
async function readFacebookPages(page) {
  await page.goto('https://www.facebook.com/pages/?category=your_pages', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForSelector('[role="main"] a[href*="asset_id="], [role="main"] a[href*="page_id="]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const pages = await page.evaluate(() => {
    const main = document.querySelector('[role="main"]') || document.body;
    const out = new Map();
    main.querySelectorAll('a[href*="asset_id="], a[href*="page_id="]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/(?:asset_id|page_id)=(\d+)/);
      if (!m) return;
      const pageId = m[1];
      if (out.has(pageId)) return;
      // Naik ke kartu Page yang memuat tautan "Profile picture for <nama>"
      let card = a.parentElement;
      let picLink = null;
      for (let i = 0; i < 12 && card; i++) {
        picLink = Array.from(card.querySelectorAll('a[aria-label], a')).find((x) => /^(profile picture for|foto profil)/i.test((x.getAttribute('aria-label') || x.innerText || '').trim()));
        if (picLink) break;
        card = card.parentElement;
      }
      if (!picLink) return;
      const label = (picLink.getAttribute('aria-label') || picLink.innerText || '').trim();
      const name = label.replace(/^(profile picture for|foto profil)\s*/i, '').trim();
      const img = picLink.querySelector('image, img');
      const avatarUrl = img ? (img.getAttribute('xlink:href') || img.getAttribute('href') || img.src || '') : '';
      const profileUrl = (picLink.href || '').replace(/[&?]__tn__=[^&]*/, '');
      out.set(pageId, { pageId, name, avatarUrl, profileUrl });
    });
    return Array.from(out.values());
  }).catch(() => []);
  for (const p of pages) p.avatar = await toDataUrl(p.avatarUrl);
  return pages;
}

module.exports = { readFacebookPages };
