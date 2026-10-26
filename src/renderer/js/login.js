document.addEventListener('DOMContentLoaded', () => {
  // Kontrol Title Bar Kustom
  document.getElementById('btnWinMinimize')?.addEventListener('click', () => {
    window.electronAPI?.minimizeWindow();
  });
  document.getElementById('btnWinClose')?.addEventListener('click', () => {
    window.electronAPI?.closeWindow();
  });

  const btnLogin = document.getElementById('btnLogin');
  const btnSpinner = document.getElementById('btnSpinner');
  const btnText = document.getElementById('btnText');
  const btnBackToPlatform = document.getElementById('btnBackToPlatform') || document.getElementById('btnSwitchPlatform');

  // Navigasi Kembali ke Layar Pilih Platform (Instagram / TikTok)
  btnBackToPlatform?.addEventListener('click', () => {
    window.electronAPI?.navigateToSelectAccount?.();
  });

  // Handler Klik Tombol Login Instagram
  btnLogin?.addEventListener('click', () => {
    if (btnLogin.disabled) return;

    btnLogin.disabled = true;
    if (btnSpinner) btnSpinner.style.display = 'inline-block';
    if (btnText) btnText.textContent = 'Membuka Form Login...';

    if (window.electronAPI && typeof window.electronAPI.triggerLogin === 'function') {
      window.electronAPI.triggerLogin();
    }

    // Reset status tombol setelah 5 detik agar tidak macet selamanya jika popup ditutup
    setTimeout(() => {
      btnLogin.disabled = false;
      if (btnSpinner) btnSpinner.style.display = 'none';
      if (btnText) btnText.textContent = 'Login dengan Akun Instagram';
    }, 5000);
  });
});