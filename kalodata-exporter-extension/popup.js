// Popup ekstensi: menampilkan status data di tab Kalodata aktif & tombol ekspor
const $ = (id) => document.getElementById(id);
let activeTabId = null;
let pollTimer = null;

$('version').textContent = `By Etnic · v${chrome.runtime.getManifest().version}`;

function ask(action) {
  return new Promise((resolve) => {
    if (activeTabId == null) return resolve(null);
    chrome.tabs.sendMessage(activeTabId, { action }, (res) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(res || null);
    });
  });
}

function saveFile(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1500);
}

async function refreshStatus() {
  const status = await ask('getStatus');
  const statusText = $('statusText');
  if (!status) {
    statusText.textContent = 'Muat ulang halaman Kalodata (F5) agar ekstensi aktif di tab ini.';
    statusText.className = 'status warn';
    ['btnCopy', 'btnDownload'].forEach((id) => { $(id).disabled = true; });
    return;
  }
  $('statProducts').textContent = status.products;
  $('statVideos').textContent = status.withVideos;
  $('statVideoTotal').textContent = `${status.playable}/${status.videos}`;
  $('btnCopy').disabled = $('btnDownload').disabled = status.products === 0;

  if (status.products === 0) {
    statusText.textContent = 'Belum ada produk. Buka / gulir daftar produk Kalodata.';
    statusText.className = 'status';
  } else if (!status.videosLoaded) {
    statusText.textContent = 'Menunggu data video GMV dimuat...';
    statusText.className = 'status warn';
  } else if (status.playable < status.videos) {
    statusText.textContent = status.lastError
      ? `Link putar belum didapat. Putar 1 video di Kalodata, lalu F5. (${status.lastError})`
      : `Mengambil link putar video (${status.playable}/${status.videos})...`;
    statusText.className = 'status warn';
  } else {
    statusText.textContent = 'Data siap diekspor ke Bot Auto Upload.';
    statusText.className = 'status ok';
  }
}

$('btnCopy').addEventListener('click', async () => {
  const res = await ask('getExportJson');
  if (!res?.json) return;
  await navigator.clipboard.writeText(res.json);
  flash($('btnCopy'), 'Tersalin');
});

$('btnDownload').addEventListener('click', async () => {
  const res = await ask('getExportJson');
  if (res?.json) saveFile('kalodata_products.json', res.json);
});

chrome.storage.local.get('products', ({ products = {} }) => { $('statSaved').textContent = Object.keys(products).length; });
chrome.storage.local.get('kaloApiLog', ({ kaloApiLog = [] }) => { $('apiLogCount').textContent = kaloApiLog.length; });
$('btnCopyApiLog').addEventListener('click', () => {
  chrome.storage.local.get('kaloApiLog', async ({ kaloApiLog = [] }) => {
    await navigator.clipboard.writeText(JSON.stringify(kaloApiLog, null, 1));
    flash($('btnCopyApiLog'), `Tersalin (${kaloApiLog.length})`);
  });
});
$('btnOpenShowcase').addEventListener('click', () => chrome.tabs.create({ url: 'https://license.etnicstore.com/showcase/' }));

$('btnOpenKalodata').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.kalodata.com/product' });
});

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const onKalodata = /^https?:\/\/([^/]+\.)?kalodata\.com\//i.test(tab?.url || '');
  $('panelActive').hidden = !onKalodata;
  $('panelInactive').hidden = onKalodata;
  if (!onKalodata) return;
  activeTabId = tab.id;
  refreshStatus();
  pollTimer = setInterval(refreshStatus, 1500);
});

window.addEventListener('unload', () => clearInterval(pollTimer));
