// Jembatan web Etnic Showcase ⇄ ekstensi.
// Web mengirim: window.postMessage({ source: 'etnic-showcase-web', id, action, payload })
// Ekstensi membalas: { source: 'etnic-showcase-ext', id, result }
const ALLOWED = new Set(['ping', 'getInstallId', 'getTikTokAccount', 'openTikTokLogin', 'getShowcaseCache', 'importKalodataProducts', 'autoFetchKalodata', 'getKaloQuota', 'getProducts', 'clearProducts', 'deleteProducts', 'getShowcase', 'addToShowcase', 'removeFromShowcase']);

function reply(data) {
  window.postMessage({ source: 'etnic-showcase-ext', ...data }, window.location.origin);
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const msg = event.data;
  if (!msg || msg.source !== 'etnic-showcase-web' || !ALLOWED.has(msg.action)) return;
  chrome.runtime.sendMessage({ action: msg.action, payload: msg.payload || {} }, (result) => {
    if (chrome.runtime.lastError) {
      reply({ id: msg.id, result: { success: false, error: chrome.runtime.lastError.message } });
      return;
    }
    reply({ id: msg.id, result });
  });
});

// Progres proses panjang (tambah / hapus etalase) dari background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'progress') reply({ type: 'progress', text: msg.text });
});

reply({ type: 'ready', version: chrome.runtime.getManifest().version });
document.addEventListener('DOMContentLoaded', () => reply({ type: 'ready', version: chrome.runtime.getManifest().version }));
