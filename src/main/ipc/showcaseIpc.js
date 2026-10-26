/**
 * src/main/ipc/showcaseIpc.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const { dialog, net } = require('electron');

module.exports = function registerShowcaseIpc(ipcMain, ctx) {
  const { PROJECT_ROOT, TIKTOK_PROFILES_DIR, getActiveAccount, cleanUserIdentifier, getOriginalChromeExecutablePath } = ctx;
  const METRICS_STORE_PATH = path.resolve(PROJECT_ROOT, 'sessions/showcase_metrics_store.json');

  function purgeTikTokSessionLocks(profileDir) {
    if (!fs.existsSync(profileDir)) return;
    ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'].forEach((f) => {
      const p = path.join(profileDir, f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {}
      }
    });
  }

  // =========================================================================
  // STATUS TIKTOK SHOP STREAMER
  // =========================================================================
  ipcMain.handle('get-tiktok-streamer-status', async () => {
    try {
      const active = getActiveAccount();
      const cleanId = cleanUserIdentifier(active?.username || active?.id || 'karuna_id');
      const shopCookiePath = path.resolve(PROJECT_ROOT, `sessions/tiktokshop_cookies_${cleanId}.json`);

      if (fs.existsSync(shopCookiePath)) {
        const cookies = JSON.parse(fs.readFileSync(shopCookiePath, 'utf-8'));
        if (Array.isArray(cookies) && cookies.some((c) => c.name === 'sessionid' || c.name === 'sid_tt')) {
          return { isLoggedIn: true, status: 'Sesi Aktif', accountName: active?.username || cleanId };
        }
      }
      return { isLoggedIn: false, status: 'Belum Login', accountName: '' };
    } catch (e) {
      return { isLoggedIn: false, status: 'Belum Login' };
    }
  });

  // =========================================================================
  // BUKA / CEK STREAMER GUI
  // =========================================================================
  ipcMain.handle('login-tiktok-streamer', async () => {
    try {
      const active = getActiveAccount();
      const cleanId = cleanUserIdentifier(active?.username || active?.id || 'karuna_id');
      const profileDir = path.resolve(TIKTOK_PROFILES_DIR, `acc_${cleanId}`);

      if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
      purgeTikTokSessionLocks(profileDir);

      const chromeExe = getOriginalChromeExecutablePath();
      if (!chromeExe) return { success: false, error: 'Google Chrome tidak ditemukan.' };

      const cdpPort = 53800 + Math.floor(Math.random() * 1000);
      const streamerUrl = 'https://shop.tiktok.com/streamer/showcase/product/list';

      const proc = spawn(chromeExe, [
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,900',
        '--window-position=60,40',
        streamerUrl
      ], { detached: true, stdio: 'ignore' });
      proc.unref();

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // =========================================================================
  // SINKRONISASI DATA SHOWCASE PRODUK (HEADLESS / RUNNING CHROME)
  // =========================================================================
  ipcMain.handle('get-tiktok-showcase-products', async (event, forceRefresh = false) => {
    const active = getActiveAccount();
    if (!active) return { success: false, error: 'Pilih akun terlebih dahulu.' };

    const cleanId = cleanUserIdentifier(active.username || active.id);
    const cacheFile = path.resolve(PROJECT_ROOT, 'sessions', `showcase_cache_${cleanId}.json`);

    if (!forceRefresh && fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        if (Array.isArray(cached) && cached.length > 0) {
          const validCached = cached.filter((item) => item.productId && /^\d{15,22}$/.test(item.productId));
          if (validCached.length > 0) {
            return { success: true, data: validCached, account: active.username };
          }
        }
      } catch (e) {}
    }

    const profileDir = path.resolve(TIKTOK_PROFILES_DIR, `acc_${cleanId}`);
    const chromeExe = getOriginalChromeExecutablePath();
    if (!chromeExe || !fs.existsSync(profileDir)) {
      return { success: false, error: 'Sesi Chrome TikTok belum ada. Silakan login streamer dahulu.' };
    }

    const candidatePorts = [53888, 53800, 54100, 52100, 53900];
    let browser = null;
    for (const p of candidatePorts) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`);
        if (browser) break;
      } catch (e) {}
    }

    let tempProc = null;
    if (!browser) {
      purgeTikTokSessionLocks(profileDir);
      const tempCdpPort = 54200 + Math.floor(Math.random() * 500);

      tempProc = spawn(chromeExe, [
        `--remote-debugging-port=${tempCdpPort}`,
        `--user-data-dir=${profileDir}`,
        '--headless=new',
        '--no-first-run',
        '--lang=id-ID',
        'https://shop.tiktok.com/streamer/showcase/product/list'
      ], { detached: true, stdio: 'ignore' });
      tempProc.unref();

      for (let i = 0; i < 25; i++) {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${tempCdpPort}`);
          if (browser) break;
        } catch (e) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }

    if (!browser) return { success: false, error: 'Gagal terhubung ke Chrome Streamer.' };

    try {
      const contexts = browser.contexts();
      let page = contexts[0]?.pages().find((p) => p.url().includes('/streamer/showcase'));

      if (!page && contexts.length > 0) {
        page = contexts[0].pages()[0] || await contexts[0].newPage();
        await page.goto('https://shop.tiktok.com/streamer/showcase/product/list', { waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      if (!page) return { success: false, error: 'Tab etalase tidak ditemukan.' };

      await page.waitForSelector('tbody tr, .arco-table-tr, [role="row"]', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1000);

      const items = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tbody tr, .arco-table-tr, [role="row"]'));
        const list = [];

        rows.forEach((r) => {
          const txt = (r.innerText || '').trim();
          if (!txt) return;

          const pidMatch = txt.match(/ID[:\s]*(\d{15,22})/i) || txt.match(/(\d{17,21})/);
          if (!pidMatch) return;

          const pid = pidMatch[1];
          const img = r.querySelector('img')?.src || '';
          const rpMatches = txt.match(/Rp[\d,.]+/g) || [];
          const price = rpMatches[0] || 'Rp0';
          const commission = rpMatches[1] || '-';

          const lines = txt.split('\n').map((l) => l.trim()).filter(Boolean);
          const title = lines.find((l) =>
            l.length > 5 &&
            !l.toLowerCase().startsWith('id:') &&
            !l.toLowerCase().startsWith('rp') &&
            !['hide', 'edit', 'remove', 'hapus', 'live', 'in stock', 'product', 'no.'].includes(l.toLowerCase())
          ) || 'Produk TikTok Shop';

          const stockMatch = txt.match(/([\d.,]+[kK]?)\s*(?:terjual|stock|in stock)?/i);
          const stock = stockMatch ? stockMatch[1] : '';

          if (!list.some((item) => item.productId === pid)) {
            list.push({
              id: pid,
              productId: pid,
              title,
              product_title: title,
              coverUrl: img,
              price,
              commission,
              stock,
              isStreamerShowcase: true
            });
          }
        });
        return list;
      });

      if (items.length > 0) {
        fs.writeFileSync(cacheFile, JSON.stringify(items, null, 2), 'utf-8');
        return { success: true, data: items, account: active.username };
      } else {
        return { success: false, error: 'Belum ada produk yang ditemukan di halaman etalase.' };
      }
    } finally {
      if (tempProc) {
        if (browser) await browser.close().catch(() => {});
        if (tempProc.pid && process.platform === 'win32') {
          try { spawn('taskkill', ['/pid', String(tempProc.pid), '/f', '/t']); } catch (e) {}
        }
      }
    }
  });

  // =========================================================================
  // TAMBAH PRODUK KE SHOWCASE (MODE HEADLESS DI LATAR BELAKANG)
  // =========================================================================
  ipcMain.handle('preview-tiktok-product-url', async (event, productUrl) => {
    const active = getActiveAccount();
    const cleanId = cleanUserIdentifier(active?.username || active?.id || 'karuna_id');
    const profileDir = path.resolve(TIKTOK_PROFILES_DIR, `acc_${cleanId}`);
    const chromeExe = getOriginalChromeExecutablePath();

    if (!productUrl) return { success: false, error: 'URL produk kosong.' };

    const pidMatch = String(productUrl).match(/(\d{15,22})/);
    const targetPid = pidMatch ? pidMatch[1] : '';
    const finalUrl = productUrl.startsWith('http') 
      ? productUrl 
      : `https://www.tiktok.com/view/product/${targetPid}`;

    let browser = null;
    let procToClose = null;

    try {
      const activePorts = [53888, 53800, 54100, 52100];
      for (const p of activePorts) {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`);
          if (browser) break;
        } catch (e) {}
      }

      // Jika belum ada Chrome yang berjalan, buka Chrome mode headless
      if (!browser) {
        if (!chromeExe || !fs.existsSync(profileDir)) {
          return { success: false, error: 'Sesi Chrome atau profil akun belum siap. Buka Pengaturan AI dahulu.' };
        }

        purgeTikTokSessionLocks(profileDir);
        const cdpPort = 53888;
        const streamerUrl = 'https://shop.tiktok.com/streamer/showcase/product/list';

        procToClose = spawn(chromeExe, [
          `--remote-debugging-port=${cdpPort}`,
          `--user-data-dir=${profileDir}`,
          '--headless=new',
          '--no-first-run',
          '--no-default-browser-check',
          '--lang=id-ID',
          streamerUrl
        ], { detached: true, stdio: 'ignore' });
        procToClose.unref();

        for (let i = 0; i < 25; i++) {
          try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
            if (browser) break;
          } catch (e) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      }

      if (!browser) return { success: false, error: 'Gagal menghubungkan bot ke browser Chrome.' };

      const contexts = browser.contexts();
      let page = null;
      for (const ctx of contexts) {
        const pages = ctx.pages();
        page = pages.find((p) => p.url().includes('shop.tiktok.com'));
        if (page) break;
      }

      if (!page && contexts.length > 0) {
        page = contexts[0].pages()[0] || await contexts[0].newPage();
      }

      if (!page) return { success: false, error: 'Tab TikTok tidak ditemukan.' };

      if (!page.url().includes('/streamer/showcase/product/list')) {
        await page.goto('https://shop.tiktok.com/streamer/showcase/product/list', { waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      await page.waitForTimeout(1500);

      // 1. Klik tombol "Add new products" jika modal belum tampil
      const isModalOpen = await page.locator('.arco-modal, [role="dialog"], h3:has-text("Add new products")').isVisible().catch(() => false);
      if (!isModalOpen) {
        const btnAddProducts = page.locator('button:has-text("Add new products")').first();
        await btnAddProducts.waitFor({ state: 'visible', timeout: 10000 });
        await btnAddProducts.click({ force: true });
        await page.waitForTimeout(1500);
      }

      // 2. Klik dulu kolom input, lalu ketikkan tautan produk
      const inputField = page.locator('input[data-tid="m4b_input"], input[placeholder*="productURL"]').first();
      await inputField.waitFor({ state: 'visible', timeout: 8000 });
      await inputField.click({ force: true });
      await page.waitForTimeout(300);
      await inputField.fill('');
      await inputField.fill(finalUrl);
      await page.waitForTimeout(600);

      // 3. Klik tombol "Product URLs" di bawah kolom input
      const btnProductUrls = page.locator('button:has-text("Product URLs"), button[data-btm="d85319"]').first();
      await btnProductUrls.waitFor({ state: 'visible', timeout: 8000 });
      await btnProductUrls.click({ force: true });
      await page.waitForTimeout(2500);

      // 4. Centang kotak produk jika belum tercentang
      const checkbox = page.locator('.arco-table-tbody input[type="checkbox"], input[type="checkbox"]').first();
      const isChecked = await checkbox.isChecked().catch(() => false);
      if (!isChecked) {
        await checkbox.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
      }

      // 5. Klik tombol "Add products" di pojok kanan bawah modal
      const btnConfirmAdd = page.locator('button:has-text("Add products"), button.pc_add_product').first();
      await btnConfirmAdd.waitFor({ state: 'visible', timeout: 8000 });
      await btnConfirmAdd.click({ force: true }).catch(() => {});

      await page.waitForTimeout(2500);

      return { success: true, productId: targetPid };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      if (procToClose) {
        if (browser) await browser.close().catch(() => {});
        if (procToClose.pid && process.platform === 'win32') {
          try { spawn('taskkill', ['/pid', String(procToClose.pid), '/f', '/t']); } catch (e) {}
        }
      }
    }
  });

  // =========================================================================
  // HAPUS PRODUK SHOWCASE: MODE HEADLESS -> REMOVE -> DELETE
  // =========================================================================
  ipcMain.handle('remove-tiktok-showcase-product', async (event, productId) => {
    const active = getActiveAccount();
    const cleanId = cleanUserIdentifier(active?.username || active?.id || 'karuna_id');
    const profileDir = path.resolve(TIKTOK_PROFILES_DIR, `acc_${cleanId}`);
    const cacheFile = path.resolve(PROJECT_ROOT, 'sessions', `showcase_cache_${cleanId}.json`);
    const chromeExe = getOriginalChromeExecutablePath();
    const targetPid = String(productId).trim();

    let browser = null;
    let procToClose = null;

    try {
      const activePorts = [53888, 53800, 54100, 52100];
      for (const p of activePorts) {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`);
          if (browser) break;
        } catch (e) {}
      }

      if (!browser) {
        if (!chromeExe || !fs.existsSync(profileDir)) {
          return { success: false, error: 'Sesi Chrome atau profil akun belum siap. Buka Pengaturan AI dahulu.' };
        }

        purgeTikTokSessionLocks(profileDir);
        const cdpPort = 53888;
        const streamerUrl = 'https://shop.tiktok.com/streamer/showcase/product/list';

        procToClose = spawn(chromeExe, [
          `--remote-debugging-port=${cdpPort}`,
          `--user-data-dir=${profileDir}`,
          '--headless=new',
          '--no-first-run',
          '--no-default-browser-check',
          '--lang=id-ID',
          streamerUrl
        ], { detached: true, stdio: 'ignore' });
        procToClose.unref();

        for (let i = 0; i < 25; i++) {
          try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
            if (browser) break;
          } catch (e) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      }

      if (!browser) return { success: false, error: 'Gagal menghubungkan bot ke browser Chrome.' };

      const contexts = browser.contexts();
      let page = null;
      for (const ctx of contexts) {
        const pages = ctx.pages();
        page = pages.find((p) => p.url().includes('/streamer/showcase'));
        if (page) break;
      }

      if (!page && contexts.length > 0) {
        page = contexts[0].pages()[0] || await contexts[0].newPage();
        await page.goto('https://shop.tiktok.com/streamer/showcase/product/list', { waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      if (!page) return { success: false, error: 'Halaman Showcase tidak ditemukan di Chrome.' };

      await page.waitForSelector('tbody tr, .arco-table-tr, [role="row"]', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);

      const removeClicked = await page.evaluate((pid) => {
        const rows = Array.from(document.querySelectorAll('tbody tr, .arco-table-tr, [role="row"]'));
        const targetRow = rows.find((r) => (r.innerText || '').includes(pid));
        if (!targetRow) return false;

        const elements = Array.from(targetRow.querySelectorAll('span.arco-link, button, a, span'));
        const removeEl = elements.find((el) => {
          const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          return txt === 'remove' || txt === 'hapus';
        });

        if (removeEl) {
          removeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          removeEl.click();
          return true;
        }
        return false;
      }, targetPid);

      if (!removeClicked) {
        return { success: false, error: `Produk dengan ID ${targetPid} tidak ditemukan di halaman tabel.` };
      }

      await page.waitForSelector('.arco-modal button, [role="dialog"] button', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);

      await page.evaluate(() => {
        const modalButtons = Array.from(document.querySelectorAll('.arco-modal button, [role="dialog"] button, button'));
        const deleteBtn = modalButtons.find((btn) => {
          const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          return txt === 'delete' || txt === 'confirm' || txt === 'hapus';
        });
        if (deleteBtn) deleteBtn.click();
      });

      await page.waitForTimeout(1200);

      if (fs.existsSync(cacheFile)) {
        try {
          let cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
          cached = cached.filter((item) => String(item.productId || item.id) !== targetPid);
          fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2), 'utf-8');
        } catch (e) {}
      }

      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('load-showcase');
      }

      return { success: true, productId: targetPid };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      if (procToClose) {
        if (browser) await browser.close().catch(() => {});
        if (procToClose.pid && process.platform === 'win32') {
          try { spawn('taskkill', ['/pid', String(procToClose.pid), '/f', '/t']); } catch (e) {}
        }
      }
    }
  });

  // =========================================================================
  // AMBIL SEMUA GAMBAR PRODUK VIA INTERCEPT RESPONS TOMBOL EDIT TIKTOK
  // =========================================================================
  ipcMain.handle('get-tiktok-product-images', async (event, productId) => {
    const active = getActiveAccount();
    const cleanId = cleanUserIdentifier(active?.username || active?.id || 'karuna_id');
    const cacheFile = path.resolve(PROJECT_ROOT, `sessions/showcase_cache_${cleanId}.json`);
    const targetPid = String(productId).trim();

    // 1. Cek apakah gambar lengkap sudah tersimpan di cache lokal
    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        const found = cached.find((item) => String(item.productId || item.id) === targetPid);
        if (found && Array.isArray(found.images) && found.images.length > 1) {
          return { success: true, productId: targetPid, images: found.images };
        }
      } catch (e) {}
    }

    const profileDir = path.resolve(TIKTOK_PROFILES_DIR, `acc_${cleanId}`);
    const chromeExe = getOriginalChromeExecutablePath();
    if (!chromeExe || !fs.existsSync(profileDir)) {
      return { success: false, error: 'Profil Chrome belum siap.', images: [] };
    }

    let browser = null;
    let procToClose = null;

    try {
      const activePorts = [53888, 53800, 54100, 52100];
      for (const p of activePorts) {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`);
          if (browser) break;
        } catch (e) {}
      }

      if (!browser) {
        purgeTikTokSessionLocks(profileDir);
        const cdpPort = 53888;
        const streamerUrl = 'https://shop.tiktok.com/streamer/showcase/product/list';

        procToClose = spawn(chromeExe, [
          `--remote-debugging-port=${cdpPort}`,
          `--user-data-dir=${profileDir}`,
          '--headless=new',
          '--no-first-run',
          '--no-default-browser-check',
          '--lang=id-ID',
          streamerUrl
        ], { detached: true, stdio: 'ignore' });
        procToClose.unref();

        for (let i = 0; i < 25; i++) {
          try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
            if (browser) break;
          } catch (e) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      }

      if (!browser) return { success: false, error: 'Gagal terhubung ke Chrome.', images: [] };

      const contexts = browser.contexts();
      let page = contexts[0]?.pages().find((p) => p.url().includes('/streamer/showcase'));

      if (!page && contexts.length > 0) {
        page = contexts[0].pages()[0] || await contexts[0].newPage();
        await page.goto('https://shop.tiktok.com/streamer/showcase/product/list', { waitUntil: 'domcontentloaded' }).catch(() => {});
      }

      if (!page) return { success: false, error: 'Halaman Showcase tidak ditemukan.', images: [] };

      await page.waitForSelector('tbody tr, .arco-table-tr, [role="row"]', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(600);

      // Siapkan pendengar network untuk menangkap respons JSON saat tombol Edit diklik
      const editResponsePromise = page.waitForResponse(async (response) => {
        try {
          if (response.status() === 200 && response.request().method() !== 'OPTIONS') {
            const url = response.url().toLowerCase();
            if (url.includes('product') || url.includes('showcase') || url.includes('streamer') || url.includes('item')) {
              const text = await response.text();
              return text.includes('"products"') && text.includes('"images"');
            }
          }
        } catch (e) {}
        return false;
      }, { timeout: 7000 }).catch(() => null);

      // 2. Cari baris produk sesuai PID dan klik tombol Edit
      const editClicked = await page.evaluate((pid) => {
        const rows = Array.from(document.querySelectorAll('tbody tr, .arco-table-tr, [role="row"]'));
        const targetRow = rows.find((r) => (r.innerText || '').includes(pid));
        if (!targetRow) return false;

        const editBtn = Array.from(targetRow.querySelectorAll('a, button, span')).find((el) => {
          const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          return txt === 'edit' || txt === 'ubah';
        });

        if (editBtn) {
          editBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          editBtn.click();
          return true;
        }
        return false;
      }, targetPid);

      let extractedImages = [];

      if (editClicked) {
        const resp = await editResponsePromise;
        if (resp) {
          try {
            const json = await resp.json();
            const prod = json?.data?.products?.find((p) => String(p.product_id) === targetPid) || json?.data?.products?.[0];
            if (prod && Array.isArray(prod.images)) {
              extractedImages = prod.images.map((imgObj) => {
                const list = imgObj.url_list || imgObj.thumb_url_list || [];
                return list[0] || '';
              }).filter(Boolean);
            }
          } catch (e) {}
        }

        // Fallback DOM jika respons API tertutup/terlewat: baca elemen foto dari modal popup Edit Product
        if (extractedImages.length === 0) {
          await page.waitForSelector('.arco-modal img, [role="dialog"] img', { timeout: 3500 }).catch(() => {});
          extractedImages = await page.evaluate(() => {
            const modalImgs = Array.from(document.querySelectorAll('.arco-modal img, [role="dialog"] img'));
            return modalImgs
              .map((img) => img.currentSrc || img.src)
              .filter((src) => src && !src.includes('data:image') && src.includes('http'));
          });
        }

        // 3. Tutup kembali modal Edit Product (Klik Cancel)
        await page.evaluate(() => {
          const cancelBtn = Array.from(document.querySelectorAll('.arco-modal button, [role="dialog"] button')).find((b) => {
            const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
            return txt === 'cancel' || txt === 'batal';
          });
          if (cancelBtn) cancelBtn.click();
        });
      }

      // 4. Simpan ke cache lokal agar pembukaan berikutnya instan
      if (extractedImages.length > 0 && fs.existsSync(cacheFile)) {
        try {
          let cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
          cached = cached.map((p) => {
            if (String(p.productId || p.id) === targetPid) {
              return { ...p, images: extractedImages };
            }
            return p;
          });
          fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2), 'utf-8');
        } catch (e) {}
      }

      return {
        success: extractedImages.length > 0,
        productId: targetPid,
        images: extractedImages
      };
    } catch (err) {
      return { success: false, error: err.message, images: [] };
    } finally {
      if (procToClose) {
        if (browser) await browser.close().catch(() => {});
        if (procToClose.pid && process.platform === 'win32') {
          try { spawn('taskkill', ['/pid', String(procToClose.pid), '/f', '/t']); } catch (e) {}
        }
      }
    }
  });

  // =========================================================================
  // HANDLERS KALODATA: GET, SAVE RAW JSON, CLEAR & IMPORT FILE
  // =========================================================================
  ipcMain.handle('get-kalodata-products', async () => {
    const p = path.resolve(PROJECT_ROOT, 'sessions/kalodata_products.json');
    if (fs.existsSync(p)) {
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return { success: true, data: Array.isArray(d) ? d : [] };
      } catch (e) {}
    }
    return { success: true, data: [] };
  });

  ipcMain.handle('save-kalodata-raw-json', async (event, payload) => {
    try {
      const p = path.resolve(PROJECT_ROOT, 'sessions/kalodata_products.json');
      let items = [];

      if (Array.isArray(payload)) {
        items = payload;
      } else if (payload && Array.isArray(payload.data)) {
        items = payload.data;
      } else if (payload && typeof payload === 'object') {
        items = [payload];
      }

      let existing = [];
      if (fs.existsSync(p)) {
        try {
          existing = JSON.parse(fs.readFileSync(p, 'utf-8'));
          if (!Array.isArray(existing)) existing = [];
        } catch (e) {}
      }

      const mergedMap = new Map();
      existing.forEach((item) => {
        const id = String(item.id || item.productId || item.product_id || '').trim();
        if (id) mergedMap.set(id, item);
      });

      items.forEach((item) => {
        const id = String(item.id || item.productId || item.product_id || '').trim();
        if (id) {
          mergedMap.set(id, {
            ...mergedMap.get(id),
            ...item,
            id: id,
            productId: id
          });
        }
      });

      const finalData = Array.from(mergedMap.values());
      fs.writeFileSync(p, JSON.stringify(finalData, null, 2), 'utf-8');

      return { success: true, count: finalData.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('clear-kalodata-products', async () => {
    try {
      const p = path.resolve(PROJECT_ROOT, 'sessions/kalodata_products.json');
      if (fs.existsSync(p)) {
        fs.writeFileSync(p, JSON.stringify([], null, 2), 'utf-8');
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('import-kalodata-file', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Pilih File JSON Kalodata',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile']
      });

      if (canceled || filePaths.length === 0) return { success: false };

      const content = fs.readFileSync(filePaths[0], 'utf-8');
      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.data) ? parsed.data : [parsed]);

      const p = path.resolve(PROJECT_ROOT, 'sessions/kalodata_products.json');
      fs.writeFileSync(p, JSON.stringify(items, null, 2), 'utf-8');

      return { success: true, count: items.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-showcase-metrics-store', async () => {
    if (fs.existsSync(METRICS_STORE_PATH)) {
      try { return JSON.parse(fs.readFileSync(METRICS_STORE_PATH, 'utf-8')); } catch (e) {}
    }
    return {};
  });

  ipcMain.handle('save-showcase-metrics-store', async (e, payload) => {
    try {
      let cur = fs.existsSync(METRICS_STORE_PATH) ? JSON.parse(fs.readFileSync(METRICS_STORE_PATH, 'utf-8')) : {};
      fs.writeFileSync(METRICS_STORE_PATH, JSON.stringify({ ...cur, ...payload }, null, 2), 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false };
    }
  });
};