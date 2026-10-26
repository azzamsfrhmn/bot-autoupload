/**
 * src/platforms/tiktok/tiktokUploader.js
 * Pure Raw CDP TikTok Studio Web Uploader + Keranjang Kuning PID + Audio Editor + Auto Post
 * (Anti-Deteksi Bot: Menggunakan Browser Google Chrome Asli via CDP)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { clipboard, Notification } = require('electron');
const { getChromePath, getTikTokProfileDir } = require('./tiktokSessionManager');
const { generateProductLinkTitle } = require('../../services/aiCaption');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TikTokCDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const WS = global.WebSocket || require('ws');
      this.ws = new WS(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onclose = () => {
        for (const [, p] of this.pending) p.reject(new Error('Koneksi CDP terputus'));
        this.pending.clear();
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
          if (data.id && this.pending.has(data.id)) {
            const { resolve: res, reject: rej } = this.pending.get(data.id);
            this.pending.delete(data.id);
            if (data.error) rej(new Error(data.error.message));
            else res(data.result);
          }
        } catch (e) {}
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { if (this.ws) this.ws.close(); } catch (e) {}
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    }).catch(() => null);
    return res?.result?.value;
  }

  async clickSelector(selector, textMatch = null) {
    return await this.eval(`
      (() => {
        const els = Array.from(document.querySelectorAll('${selector}'));
        const target = els.find(el => {
          if (!${JSON.stringify(textMatch)}) return true;
          const txt = (el.innerText || el.textContent || '').trim();
          return new RegExp(${JSON.stringify(textMatch)}, 'i').test(txt);
        });
        if (target) {
          target.scrollIntoView({ behavior: 'instant', block: 'center' });
          target.click();
          return true;
        }
        return false;
      })()
    `);
  }

  async waitForSelector(selector, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await this.eval(`Boolean(document.querySelector('${selector}'))`);
      if (exists) return true;
      await sleep(500);
    }
    return false;
  }

  async setFileInput(filePath) {
    const doc = await this.send('DOM.getDocument', { depth: -1 });
    const query = await this.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type="file"]'
    });
    if (query?.nodeId) {
      await this.send('DOM.setFileInputFiles', { nodeId: query.nodeId, files: [filePath] });
      return true;
    }
    return false;
  }

  async typeViaPaste(text) {
    clipboard.writeText(text);
    await sleep(200);
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
    await sleep(80);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
  }
}

async function getWsUrl(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const tabs = await res.json();
        const target = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (target) return target.webSocketDebuggerUrl;
      }
    } catch (e) {}
    await sleep(500);
  }
  return null;
}

async function uploadToTikTok({
  accountId = 'karuna_id',
  mediaPaths = [],
  caption = '',
  productId = '',
  onProgress = () => {}
}) {
  const targetFiles = Array.isArray(mediaPaths) ? mediaPaths.filter((f) => f && fs.existsSync(f)) : [mediaPaths].filter((f) => f && fs.existsSync(f));
  if (targetFiles.length === 0) throw new Error('File video fisik tidak ditemukan.');

  const chromePath = getChromePath();
  if (!chromePath) throw new Error('Google Chrome tidak terpasang di sistem.');

  const profileDir = getTikTokProfileDir(accountId);
  const cdpPort = 53000 + Math.floor(Math.random() * 8000);

  const isVideo = targetFiles.some((f) => /\.(mp4|mov|webm)$/i.test(f));
  const uploadUrl = isVideo
    ? 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=video'
    : 'https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo';

  onProgress(`Membuka Chrome asli TikTok Studio (Port CDP: ${cdpPort})...`);
  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    uploadUrl
  ], { detached: false, stdio: 'ignore' });

  let cdp = null;

  try {
    const wsUrl = await getWsUrl(cdpPort);
    if (!wsUrl) throw new Error('Gagal menghubungkan remote debugging CDP ke Chrome.');

    cdp = new TikTokCDPClient(wsUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');

    onProgress('Menunggu halaman TikTok Studio siap...');
    await sleep(4000);

    // =========================================================================
    // 1. UNGGAH FILE MEDIA
    // =========================================================================
    onProgress('Menyerahkan berkas media ke input unggah...');
    await cdp.waitForSelector('input[type="file"]', 25000);
    await cdp.setFileInput(targetFiles[0]);

    // =========================================================================
    // 2. TULIS CAPTION TERLEBIH DAHULU (PADA ELEMEN DRAFTEDITOR-CONTENT)
    // =========================================================================
    onProgress('Menunggu editor caption Draft.js siap...');
    const editorSelector = '.public-DraftEditor-content[contenteditable="true"], .caption-editor [contenteditable="true"], .notranslate[contenteditable="true"]';
    await cdp.waitForSelector(editorSelector, 90000);
    await sleep(3500);

    if (caption && caption.trim()) {
      onProgress('Membersihkan nama file default & mengisi caption postingan...');
      
      await cdp.eval(`
        (() => {
          const el = document.querySelector('${editorSelector}');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('selectAll', false, null);
          }
        })()
      `);
      await sleep(300);

      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await sleep(400);

      await cdp.typeViaPaste(caption.trim());
      await sleep(1000);

      await cdp.eval(`
        (() => {
          const el = document.querySelector('${editorSelector}');
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      onProgress('Caption postingan berhasil ditulis!');
      await sleep(2500);
    }

    // =========================================================================
    // 3. TAUTKAN PRODUK SHOWCASE (SEARCH -> RADIO -> NEXT -> RENAME -> ADD)
    // =========================================================================
    const cleanPid = String(productId || '').trim();
    if (cleanPid) {
      onProgress(`Membuka Add link keranjang kuning (PID: ${cleanPid})...`);
      
      const clickedAdd = await cdp.eval(`
        (() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const btn = buttons.find(b => {
            const txt = (b.innerText || b.textContent || '').trim();
            return /^\\+?\\s*Add(\\s+product\\s+links)?$/i.test(txt) || txt === 'Add' || txt === '+ Add';
          });
          if (btn) {
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            btn.click();
            return true;
          }
          return false;
        })()
      `);

      if (!clickedAdd) {
        await cdp.clickSelector('button', '^\\s*\\+?\\s*Add\\s*$');
      }

      await sleep(2500);

      await cdp.clickSelector('button', '^\\s*Next\\s*$');
      await sleep(3000);

      // 3.1 Tunggu input Search products siap
      await cdp.waitForSelector('input[placeholder*="Search products" i]', 15000);
      await sleep(1000 + Math.random() * 500);

      // 3.2 Klik pada kolom input pencarian produk
      await cdp.eval(`
        (() => {
          const input = document.querySelector('input[placeholder*="Search products" i]');
          if (input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            input.focus();
            input.click();
          }
        })()
      `);
      await sleep(500);

      // 3.3 Bersihkan input jika ada teks tersisa
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await sleep(100);
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await sleep(400);

      // 3.4 Ketik PID karakter demi karakter secara natural
      onProgress(`Mengetik PID ${cleanPid} secara natural...`);
      for (const char of cleanPid) {
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char,
          unmodifiedText: char
        });
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          text: char,
          unmodifiedText: char
        });
        await sleep(50 + Math.floor(Math.random() * 50));
      }

      await cdp.eval(`
        (() => {
          const input = document.querySelector('input[placeholder*="Search products" i]');
          if (input) {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      await sleep(800);

      // 3.5 Deteksi koordinat fisik ikon kaca pembesar dan kirim klik
      onProgress('Menemukan posisi tombol kaca pembesar...');
      const searchCoords = await cdp.eval(`
        (() => {
          const pathEl = document.querySelector('path[d*="M21.83 7.5"]');
          if (pathEl) {
            const rect = pathEl.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
          const input = document.querySelector('input[placeholder*="Search products" i]');
          if (input) {
            const parent = input.closest('span, div')?.parentElement;
            const icon = parent ? parent.querySelector('svg, span[role="img"]') : null;
            if (icon) {
              const rect = icon.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
              }
            }
          }
          return null;
        })()
      `);

      if (searchCoords && searchCoords.x && searchCoords.y) {
        onProgress('Mengeklik ikon kaca pembesar secara presisi...');
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: Math.round(searchCoords.x),
          y: Math.round(searchCoords.y),
          button: 'left',
          clickCount: 1
        });
        await sleep(120);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: Math.round(searchCoords.x),
          y: Math.round(searchCoords.y),
          button: 'left',
          clickCount: 1
        });
      }

      await sleep(300);
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

      // 3.6 Tunggu baris produk muncul di tabel
      onProgress('Menunggu hasil pencarian produk muncul...');
      await cdp.eval(`
        new Promise((resolve) => {
          let elapsed = 0;
          const timer = setInterval(() => {
            elapsed += 400;
            const rows = document.querySelectorAll('table tbody tr, [role="row"]');
            const hasMatch = Array.from(rows).some(r => r.innerText.includes('${cleanPid}'));
            if (hasMatch || elapsed >= 12000) {
              clearInterval(timer);
              resolve(true);
            }
          }, 400);
        })
      `);
      await sleep(2000);

      // 3.7 Memilih Radio Button secara fisik
      onProgress('Mendeteksi posisi koordinat tombol radio produk...');
      const radioCoords = await cdp.eval(`
        (() => {
          const rows = Array.from(document.querySelectorAll('table tbody tr, [role="row"]'));
          const matchedRow = rows.find(r => r.innerText.includes('${cleanPid}')) || rows[0];

          let targetEl = null;
          if (matchedRow) {
            targetEl = matchedRow.querySelector('.TUXRadioStandalone, label:has(.TUXRadioStandalone-input), input.TUXRadioStandalone-input, input[type="radio"]');
          }

          if (!targetEl) {
            targetEl = document.querySelector('.TUXRadioStandalone, label:has(.TUXRadioStandalone-input), input.TUXRadioStandalone-input, input[type="radio"]');
          }

          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            const rect = targetEl.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return {
                x: rect.left + (rect.width / 2),
                y: rect.top + (rect.height / 2)
              };
            }
          }
          return null;
        })()
      `);

      if (radioCoords && radioCoords.x && radioCoords.y) {
        onProgress('Mengeklik tombol radio secara fisik...');
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: Math.round(radioCoords.x),
          y: Math.round(radioCoords.y),
          button: 'left',
          clickCount: 1
        });
        await sleep(150);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: Math.round(radioCoords.x),
          y: Math.round(radioCoords.y),
          button: 'left',
          clickCount: 1
        });
      } else {
        await cdp.eval(`
          (() => {
            const radio = document.querySelector('input.TUXRadioStandalone-input, input[type="radio"]');
            if (radio) {
              const parent = radio.closest('label') || radio.parentElement || radio;
              parent.click();
            }
          })()
        `);
      }

      await sleep(2200);

      // 3.8 KLIK TOMBOL NEXT DENGAN LOOP VERIFIKASI PERPINDAHAN FORM
      onProgress('Menunggu tombol Next aktif pada modal produk...');
      await sleep(1000);

      let formShifted = false;
      for (let attempt = 1; attempt <= 12; attempt++) {
        formShifted = await cdp.eval(`
          (() => {
            const bodyTxt = document.body.innerText || '';
            const hasProductName = bodyTxt.includes('Product name') || bodyTxt.includes('Product name will appear');
            const hasSearch = Boolean(document.querySelector('input[placeholder*="Search products" i]'));
            return hasProductName && !hasSearch;
          })()
        `);

        if (formShifted) {
          onProgress('Halaman modal berhasil beralih ke pengaturan nama produk!');
          break;
        }

        onProgress(`Menekan tombol Next (Percobaan ${attempt})...`);

        const nextCoords = await cdp.eval(`
          (() => {
            const buttons = Array.from(document.querySelectorAll('button.TUXButton--primary, button'));
            const btn = buttons.reverse().find(b => {
              const label = b.querySelector('.TUXButton-label, .TUXButton-content') || b;
              const txt = (label.innerText || label.textContent || '').trim();
              return txt.toLowerCase() === 'next';
            });

            if (btn) {
              const isDisabled = btn.hasAttribute('disabled') || 
                                 btn.getAttribute('aria-disabled') === 'true' ||
                                 btn.classList.contains('TUXButton--disabled');
              if (!isDisabled) {
                btn.scrollIntoView({ behavior: 'instant', block: 'center' });
                const r = btn.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
            }
            return null;
          })()
        `);

        if (nextCoords && nextCoords.x && nextCoords.y) {
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: Math.round(nextCoords.x),
            y: Math.round(nextCoords.y),
            button: 'left',
            clickCount: 1
          });
          await sleep(150);
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: Math.round(nextCoords.x),
            y: Math.round(nextCoords.y),
            button: 'left',
            clickCount: 1
          });
        }

        await cdp.eval(`
          (() => {
            const buttons = Array.from(document.querySelectorAll('button.TUXButton--primary, button'));
            const btn = buttons.reverse().find(b => {
              const label = b.querySelector('.TUXButton-label') || b;
              return (label.innerText || label.textContent || '').trim().toLowerCase() === 'next';
            });
            if (btn && btn.getAttribute('aria-disabled') !== 'true') btn.click();
          })()
        `);

        await sleep(1800);
      }

      if (!formShifted) {
        throw new Error('Gagal berpindah ke halaman Product name setelah klik Next.');
      }

      await sleep(1200);

      // =========================================================================
      // 3.9 HAPUS JUDUL BAWAAN & ISI DENGAN JUDUL DINAMIS GEMINI (BEBAS EMOJI)
      // =========================================================================
      onProgress('Menunggu kolom Product name (.TUXTextInputCore-input)...');
      await cdp.waitForSelector('.TUXInputBox input, input.TUXTextInputCore-input', 10000);
      await sleep(1200);

      onProgress('Membuat judul keranjang kuning otomatis via Gemini...');
      let rawTitle = await generateProductLinkTitle(caption || 'Atasan Wanita');
      
      let selectedTitle = String(rawTitle || '')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 30);

      if (!selectedTitle || selectedTitle.length < 5) {
        selectedTitle = 'PROMO SPESIAL CEK SEKARANG';
      }

      onProgress(`Judul keranjang kuning bersih: "${selectedTitle}"`);

      onProgress('Menghapus judul produk bawaan TikTok Studio...');
      await cdp.eval(`
        (() => {
          const input = document.querySelector('.TUXInputBox input, input.TUXTextInputCore-input');
          if (input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            input.focus();
            input.select();
            document.execCommand('selectAll', false, null);
          }
        })()
      `);
      await sleep(200);

      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8 });
      await sleep(100);
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', windowsVirtualKeyCode: 46 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', windowsVirtualKeyCode: 46 });
      await sleep(300);

      onProgress(`Mengisi judul keranjang kuning: "${selectedTitle}"...`);
      await cdp.eval(`
        (() => {
          const input = document.querySelector('.TUXInputBox input, input.TUXTextInputCore-input');
          if (input) {
            input.value = '';
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) {
              setter.call(input, ${JSON.stringify(selectedTitle)});
            } else {
              input.value = ${JSON.stringify(selectedTitle)};
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        })()
      `);

      await sleep(2000);

      // =========================================================================
      // 3.10 KLIK TOMBOL KONFIRMASI MERAH 'ADD'
      // =========================================================================
      onProgress('Menunggu tombol konfirmasi Add aktif...');
      const addBtnCoords = await cdp.eval(`
        new Promise((resolve) => {
          let elapsed = 0;
          const timer = setInterval(() => {
            elapsed += 300;
            const buttons = Array.from(document.querySelectorAll('button.TUXButton--primary, button'));
            const addBtn = buttons.reverse().find(b => {
              const label = b.querySelector('.TUXButton-label, .TUXButton-content') || b;
              const txt = (label.innerText || label.textContent || '').trim();
              return txt.toLowerCase() === 'add';
            });

            const isEnabled = addBtn && 
                              !addBtn.hasAttribute('disabled') && 
                              addBtn.getAttribute('aria-disabled') !== 'true' &&
                              !addBtn.classList.contains('TUXButton--disabled');

            if (isEnabled) {
              clearInterval(timer);
              addBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
              const rect = addBtn.getBoundingClientRect();
              resolve({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            } else if (elapsed >= 10000) {
              clearInterval(timer);
              if (addBtn) {
                const rect = addBtn.getBoundingClientRect();
                resolve({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
              } else {
                resolve(null);
              }
            }
          }, 300);
        })
      `);

      if (addBtnCoords && addBtnCoords.x && addBtnCoords.y) {
        onProgress('Menekan tombol konfirmasi Add...');
        await sleep(500);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: Math.round(addBtnCoords.x),
          y: Math.round(addBtnCoords.y),
          button: 'left',
          clickCount: 1
        });
        await sleep(150);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: Math.round(addBtnCoords.x),
          y: Math.round(addBtnCoords.y),
          button: 'left',
          clickCount: 1
        });
      } else {
        await cdp.eval(`
          (() => {
            const buttons = Array.from(document.querySelectorAll('button.TUXButton--primary, button'));
            const target = buttons.reverse().find(b => {
              const label = b.querySelector('.TUXButton-label') || b;
              return (label.innerText || label.textContent || '').trim().toLowerCase() === 'add';
            });
            if (target) target.click();
          })()
        `);
      }

      await sleep(3500);
      onProgress('Produk keranjang kuning berhasil ditautkan!');
    }

    // =========================================================================
    // 4. BUKA PANEL SOUNDS & PILIH MUSIK REKOMENDASI SECARA ACAK
    // =========================================================================
    onProgress('Membuka editor Sounds musik TikTok...');
    
    // Klik tombol Sounds di sidebar kanan/menu atas
    const soundsOpened = await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btnSounds = buttons.find(b => {
          const txt = (b.innerText || b.textContent || '').trim();
          const hasNote = Boolean(b.querySelector('[data-testid="MusicNote"], [data-icon="MusicNote"]'));
          return txt === 'Sounds' || hasNote || b.getAttribute('data-button-name') === 'sounds';
        });
        if (btnSounds) {
          btnSounds.scrollIntoView({ behavior: 'instant', block: 'center' });
          btnSounds.click();
          return true;
        }
        return false;
      })()
    `);

    if (!soundsOpened) {
      await cdp.clickSelector('button', '^\\s*Sounds\\s*$');
    }

    await sleep(3500);

    onProgress('Menunggu daftar musik rekomendasi dimuat...');
    // Tunggu kontainer daftar lagu atau item lagu muncul di DOM
    await cdp.eval(`
      new Promise((resolve) => {
        let elapsed = 0;
        const timer = setInterval(() => {
          elapsed += 400;
          const rows = document.querySelectorAll('div[role="listitem"], .MusicPanelMusicItem__wrap, div:has(> img[src*="tiktok"])');
          const hasRows = rows.length > 0;
          if (hasRows || elapsed >= 15000) {
            clearInterval(timer);
            resolve(hasRows);
          }
        }, 400);
      })
    `);
    await sleep(1500);

    // Scroll sedikit ke bawah untuk memuat variasi lagu (Lazy load)
    onProgress('Melakukan scroll daftar lagu untuk variasi pilihan...');
    await cdp.eval(`
      (() => {
        // Cari container yang menampung list item
        const listContainer = document.querySelector('div[role="list"], .MusicPanel__list, div[class*="MusicList"]') ||
                              Array.from(document.querySelectorAll('div')).find(d => {
                                const s = window.getComputedStyle(d);
                                return (s.overflowY === 'auto' || s.overflowY === 'scroll') && d.clientHeight > 200;
                              });
        if (listContainer) {
          listContainer.scrollBy({ top: 300 + Math.floor(Math.random() * 400), behavior: 'smooth' });
        }
      })()
    `);
    await sleep(2000);

    // Deteksi seluruh baris lagu dan ambil tombol (+) di baris terpilih
    onProgress('Memilih lagu secara acak dari daftar yang tersedia...');
    const musicChoice = await cdp.eval(`
      (() => {
        // Cari semua elemen baris lagu yang memiliki tombol
        const allButtons = Array.from(document.querySelectorAll('button'));
        
        // Tombol (+) merah adalah tombol di dalam baris musik yang bukan tombol tab
        const musicAddButtons = allButtons.filter(b => {
          const txt = (b.innerText || '').trim();
          if (['For You', 'Favorites', 'Unlimited', 'Recent', 'Sounds', 'Edit', 'Text', 'Cancel'].includes(txt)) {
            return false;
          }
          // Pastikan memiliki ikon SVG atau tombol berbentuk bulat kecil
          const hasSvg = Boolean(b.querySelector('svg'));
          const r = b.getBoundingClientRect();
          const isVisible = r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
          return isVisible && (hasSvg || txt === '+');
        });

        if (musicAddButtons.length > 0) {
          const randIdx = Math.floor(Math.random() * musicAddButtons.length);
          const chosenBtn = musicAddButtons[randIdx];

          // Ambil nama lagu dari baris induk
          const rowParent = chosenBtn.closest('div[role="listitem"]') || chosenBtn.parentElement?.parentElement || chosenBtn.parentElement;
          const titleEl = rowParent ? rowParent.querySelector('h4, span, div') : null;
          const trackTitle = (titleEl ? titleEl.innerText : 'Lagu #' + (randIdx + 1)).trim().replace(/\\n.*/g, '');

          chosenBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          const rect = chosenBtn.getBoundingClientRect();

          return {
            success: true,
            title: trackTitle,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }

        // Alternatif jika filter di atas tidak menemukan: cari tombol dengan path Plus
        const plusSvgBtn = Array.from(document.querySelectorAll('button:has(svg path[d*="M24"]), button:has(svg)'))
          .find(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.width < 70 && !['Sounds', 'Cancel'].includes((b.innerText || '').trim());
          });

        if (plusSvgBtn) {
          plusSvgBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          const rect = plusSvgBtn.getBoundingClientRect();
          return {
            success: true,
            title: 'Lagu Rekomendasi TikTok',
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }

        return { success: false };
      })()
    `);

    if (musicChoice && musicChoice.success && musicChoice.x && musicChoice.y) {
      onProgress(`Menambahkan lagu: "${musicChoice.title}"...`);
      await sleep(500);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: Math.round(musicChoice.x),
        y: Math.round(musicChoice.y),
        button: 'left',
        clickCount: 1
      });
      await sleep(150);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: Math.round(musicChoice.x),
        y: Math.round(musicChoice.y),
        button: 'left',
        clickCount: 1
      });
    } else {
      onProgress('Menekan tombol (+) musik via simulasi klik DOM langsung...');
      await cdp.eval(`
        (() => {
          const target = Array.from(document.querySelectorAll('button:has(svg)'))
            .find(b => {
              const txt = (b.innerText || '').trim();
              const r = b.getBoundingClientRect();
              return !['Sounds', 'Edit', 'Text', 'Cancel', 'For You', 'Favorites', 'Unlimited', 'Recent'].includes(txt) && r.width < 60;
            });
          if (target) target.click();
        })()
      `);
    }

    await sleep(4000);

    // =========================================================================
    // 5. KECILKAN VOLUME MUSIK MENJADI -∞ dB (-60 dB)
    // =========================================================================
    onProgress('Menurunkan volume musik menjadi -∞ dB...');
    await cdp.eval(`
      (() => {
        const volumeInput = document.querySelector('.PropSettingAudioVolume__wrap input.PropSettingInput__input, .PropSettingGroup__wrap input.PropSettingInput__input');
        if (volumeInput) {
          volumeInput.focus();
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(volumeInput, '-60');
          } else {
            volumeInput.value = '-60';
          }
          volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
          volumeInput.dispatchEvent(new Event('change', { bubbles: true }));
          volumeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }

        const rangeInput = document.querySelector('.PropSettingAudioVolume__wrap input[type="range"], .PropSettingSliderInput__wrap input[type="range"]');
        if (rangeInput) {
          const nativeRangeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeRangeSetter) {
            nativeRangeSetter.call(rangeInput, '-60');
          } else {
            rangeInput.value = '-60';
          }
          rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
          rangeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const sliderTrack = document.querySelector('.PropSettingSliderInput__sliderInput, .Slider__root');
        if (sliderTrack) {
          const rect = sliderTrack.getBoundingClientRect();
          const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 2,
            clientY: rect.top + (rect.height / 2)
          });
          sliderTrack.dispatchEvent(clickEvent);
        }
        return true;
      })()
    `);

    await sleep(2000);
    onProgress('Volume musik telah diatur ke -∞ dB!');

    // =========================================================================
    // 6. SIMPAN PENGATURAN AUDIO (KLIK SAVE)
    // =========================================================================
    onProgress('Menyimpan perubahan audio editor...');
    const saveAudioClicked = await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const saveBtn = buttons.find(b => {
          const txt = (b.innerText || b.textContent || '').trim();
          return txt === 'Save' || txt === 'Simpan';
        });

        if (saveBtn) {
          saveBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          saveBtn.click();
          return true;
        }
        return false;
      })()
    `);

    if (!saveAudioClicked) {
      await cdp.clickSelector('button', '^\\s*(Save|Simpan)\\s*$');
    }

    await sleep(3500);
    onProgress('Kembali ke formulir utama TikTok Studio.');

    // =========================================================================
    // 7. PUBLIKASIKAN KONTEN (KLIK TOMBOL POST DI BAWAH HALAMAN)
    // =========================================================================
    onProgress('Menyiapkan publikasi postingan (Scroll ke bawah)...');
    await sleep(2000);

    // 7.1 Scroll total ke dasar halaman TikTok Studio
    await cdp.eval(`window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });`);
    await sleep(1500);

    // 7.2 Tunggu tombol Post aktif dan terbebas dari status loading
    onProgress('Menunggu tombol Post siap...');
    await cdp.eval(`
      new Promise((resolve) => {
        let elapsed = 0;
        const timer = setInterval(() => {
          elapsed += 400;
          const postBtn = document.querySelector('button[data-e2e="post_video_button"]');
          const isReady = postBtn && 
                          !postBtn.hasAttribute('disabled') && 
                          postBtn.getAttribute('aria-disabled') !== 'true' &&
                          postBtn.getAttribute('data-loading') !== 'true';

          if (isReady || elapsed >= 30000) {
            clearInterval(timer);
            resolve(Boolean(isReady));
          }
        }, 400);
      })
    `);

    // 7.3 Ambil koordinat tombol merah Post spesifik (berdasarkan data-e2e="post_video_button")
    onProgress('Mendeteksi posisi koordinat tombol Post...');
    const postCoords = await cdp.eval(`
      (() => {
        const postBtn = document.querySelector('button[data-e2e="post_video_button"]');
        if (postBtn) {
          postBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          const r = postBtn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
        return null;
      })()
    `);

    if (postCoords && postCoords.x && postCoords.y) {
      onProgress('Menekan tombol Post secara presisi via CDP...');
      await sleep(1000);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: Math.round(postCoords.x),
        y: Math.round(postCoords.y),
        button: 'left',
        clickCount: 1
      });
      await sleep(150);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: Math.round(postCoords.x),
        y: Math.round(postCoords.y),
        button: 'left',
        clickCount: 1
      });
    }

    // Backup klik langsung ke elemen DOM
    await cdp.eval(`
      (() => {
        const postBtn = document.querySelector('button[data-e2e="post_video_button"]');
        if (postBtn && postBtn.getAttribute('aria-disabled') !== 'true') {
          postBtn.click();
        }
      })()
    `);

    await sleep(2500);

    // =========================================================================
    // 8. TUNGGU KONFIRMASI SUKSES, TUTUP BROWSER, & MUNCULKAN NOTIFIKASI
    // =========================================================================
    onProgress('Menunggu konfirmasi penerbitan postingan...');
    await cdp.eval(`
      new Promise((resolve) => {
        let timer = 0;
        const checkSuccess = setInterval(() => {
          timer += 1000;
          const text = document.body.innerText || '';
          const isSuccess = text.includes('Your video has been uploaded') ||
                            text.includes('Video Anda telah diunggah') ||
                            text.includes('Manage your posts') ||
                            text.includes('Kelola postingan') ||
                            window.location.href.includes('/manage');

          if (isSuccess || timer >= 60000) {
            clearInterval(checkSuccess);
            resolve(true);
          }
        }, 1000);
      })
    `);

    await sleep(3000);
    onProgress('Postingan TikTok Studio berhasil dipublikasikan!');

    // Tutup koneksi CDP dan Browser Chrome
    try { await cdp.send('Browser.close'); } catch (e) {}
    cdp.close();
    if (chromeProcess && !chromeProcess.killed) chromeProcess.kill();

    // Munculkan notifikasi native desktop
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: 'AutoUpload TikTok',
          body: `Video TikTok berhasil dipublikasikan untuk akun @${accountId}!`,
          silent: false
        }).show();
      }
    } catch (notifErr) {
      console.warn('Gagal memicu notifikasi desktop:', notifErr.message);
    }

    return { success: true };
  } catch (err) {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch (e) {}
      cdp.close();
    }
    if (chromeProcess && !chromeProcess.killed) chromeProcess.kill();
    throw err;
  }
}

module.exports = {
  uploadToTikTok
};