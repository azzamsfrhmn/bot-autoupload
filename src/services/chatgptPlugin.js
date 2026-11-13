/**
 * src/services/chatgptPlugin.js
 * ChatGPT tidak lagi membuka storyboard lewat link Custom GPT: plugin dipanggil dengan "@Nama Plugin" di chat baru.
 * Alur: chat baru → ketik "@" + awal nama → klik plugin yang namanya sama persis di daftar → ketik pesan pertama → kirim.
 */
const NEW_CHAT_URL = 'https://chatgpt.com/';
const INPUT_SELECTOR = '#prompt-textarea, div.ProseMirror, div[contenteditable="true"]';
// Item daftar mention: <button data-list-navigation-item="true" data-plugin-impression-id="Plugin_..."><span class="truncate">Nama</span>...
const MENU_ITEM_SELECTOR = 'button[data-plugin-impression-id], button[data-list-navigation-item="true"]';
const SEND_SELECTOR = 'button[data-testid="send-button"], #composer-submit-button, button[aria-label="Send prompt"], button[aria-label="Send"]';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Klik item daftar plugin yang namanya sama persis; true bila berhasil
async function clickPluginInMenu(page, pluginName, timeoutMs) {
  const target = norm(pluginName);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = await page.evaluate(({ selector, target }) => {
      const items = Array.from(document.querySelectorAll(selector));
      const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return items.findIndex((el) => {
        // Nama ada di span.truncate bagian dalam; span luar berisi nama + deskripsi
        const nameEl = el.querySelector('span.truncate span.truncate') || el.querySelector('span.truncate');
        return clean(nameEl?.textContent) === target;
      });
    }, { selector: MENU_ITEM_SELECTOR, target }).catch(() => -1);

    if (index >= 0) {
      await page.locator(MENU_ITEM_SELECTOR).nth(index).click().catch(() => {});
      return true;
    }
    await sleep(400);
  }
  return false;
}

// Setelah dipilih, nama plugin tampil sebagai "chip" di kolom chat (teks "@..." yang diketik hilang)
async function hasPluginChip(page, pluginName) {
  return page.evaluate(({ selector, target }) => {
    const input = document.querySelector(selector);
    const text = String(input?.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return text.includes(target) && !text.includes('@');
  }, { selector: INPUT_SELECTOR, target: norm(pluginName) }).catch(() => false);
}

/**
 * Buka chat baru, pilih plugin lewat @, lalu kirim pesan pertama (mis. "RUN").
 * Melempar error yang jelas bila plugin belum ditambahkan di akun ChatGPT.
 */
async function startPluginChat(page, pluginName, firstMessage = 'RUN', onProgress = () => {}) {
  onProgress(`Membuka chat baru ChatGPT dengan plugin @${pluginName}...`);
  await page.goto(NEW_CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  const input = page.locator(INPUT_SELECTOR).first();
  await input.waitFor({ state: 'visible', timeout: 90000 });
  await sleep(1500);

  for (let attempt = 1; attempt <= 3; attempt++) {
    await input.click().catch(() => {});
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await sleep(300);

    // "@" saja sudah memunculkan semua plugin. Spasi menutup menu, jadi penyaring hanya kata pertama nama plugin.
    await page.keyboard.type('@', { delay: 60 });
    let picked = await clickPluginInMenu(page, pluginName, 4000);
    if (!picked) {
      await page.keyboard.type(pluginName.split(' ')[0], { delay: 60 });
      picked = await clickPluginInMenu(page, pluginName, 8000);
    }
    await sleep(600);

    if (picked && await hasPluginChip(page, pluginName)) {
      await page.keyboard.press('End');
      await page.keyboard.type(` ${firstMessage}`, { delay: 25 });
      await sleep(500);
      const sendBtn = page.locator(SEND_SELECTOR).first();
      if (await sendBtn.isVisible({ timeout: 3000 }).catch(() => false)) await sendBtn.click().catch(() => {});
      else await page.keyboard.press('Enter');
      await sleep(2000);
      return true;
    }

    onProgress(`Plugin @${pluginName} belum terpilih, mencoba lagi (${attempt}/3)...`);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1200);
  }

  throw new Error(`Plugin ChatGPT "${pluginName}" tidak muncul saat mengetik @. Pastikan plugin sudah ditambahkan di akun ChatGPT (menu Plugins).`);
}

module.exports = { startPluginChat };
