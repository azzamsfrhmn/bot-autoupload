package com.botupload.tapper;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.Path;
import android.graphics.Rect;
import android.media.MediaScannerConnection;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.net.wifi.WifiManager;
import android.util.Base64;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Tap Server: AccessibilityService yang menjalankan perintah dari aplikasi Bot Auto Upload di PC.
 *
 * Dua jalur perintah:
 *  1. WiFi TANPA kabel/ADB: server HTTP mini (LinkServer) + kode pasangan  ← jalur utama
 *  2. ADB broadcast (cadangan): am broadcast -a com.botupload.tapper.TAP -p com.botupload.tapper --ei x 540 --ei y 1200
 *
 * Tidak memakai injeksi event (INJECT_EVENTS) → lolos blokir MIUI tanpa akun Mi.
 */
public class TapService extends AccessibilityService {

    private BroadcastReceiver rx;
    private LinkServer link;
    private volatile String focusPkg = "";
    private volatile String focusCls = "";

    @Override
    public void onServiceConnected() {
        holdAwake(true);
        IntentFilter f = new IntentFilter();
        for (String a : new String[]{"TAP", "SWIPE", "TEXT", "SCAN", "WAKE", "SCREEN_OFF", "BACK", "HOME"}) {
            f.addAction("com.botupload.tapper." + a);
        }
        rx = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                String a = i.getAction();
                if (a == null) return;
                if (a.endsWith(".TAP")) {
                    doTap(i.getIntExtra("x", 0), i.getIntExtra("y", 0));
                } else if (a.endsWith(".SWIPE")) {
                    doSwipe(i.getIntExtra("x1", 0), i.getIntExtra("y1", 0),
                            i.getIntExtra("x2", 0), i.getIntExtra("y2", 0), i.getIntExtra("dur", 300));
                } else if (a.endsWith(".TEXT")) {
                    String b64 = i.getStringExtra("b64");
                    String txt = b64 != null
                            ? new String(Base64.decode(b64, Base64.DEFAULT), java.nio.charset.StandardCharsets.UTF_8)
                            : i.getStringExtra("msg");
                    setFocusedText(txt);
                } else if (a.endsWith(".SCAN")) {
                    scan(i.getStringExtra("path"));
                } else if (a.endsWith(".WAKE")) {
                    wake();
                } else if (a.endsWith(".SCREEN_OFF")) {
                    screenOff();
                } else if (a.endsWith(".BACK")) {
                    performGlobalAction(GLOBAL_ACTION_BACK);
                } else if (a.endsWith(".HOME")) {
                    performGlobalAction(GLOBAL_ACTION_HOME);
                }
            }
        };
        registerReceiver(rx, f);

        // Jalur WiFi tanpa kabel
        link = new LinkServer(this);
        link.start();
    }

    // ================= aksi =================
    void doTap(int x, int y) {
        Path p = new Path();
        p.moveTo(x, y);
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(p, 0, 60));
        dispatchGesture(b.build(), null, null);
    }

    void doSwipe(int x1, int y1, int x2, int y2, int dur) {
        Path p = new Path();
        p.moveTo(x1, y1);
        p.lineTo(x2, y2);
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(p, 0, Math.max(50, dur)));
        dispatchGesture(b.build(), null, null);
    }

    private PowerManager.WakeLock wl;

    @SuppressWarnings("deprecation")
    void wake() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (wl == null) {
                wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "tapper:wake");
                wl.setReferenceCounted(false);
            }
            if (!wl.isHeld()) wl.acquire(10 * 60 * 1000L); // auto-lepas maks 10 menit
        } catch (Exception ignored) {}
        try {
            Intent w = new Intent(this, WakeActivity.class);
            w.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(w);                                // buka keyguard (kunci geser / tanpa kunci)
        } catch (Exception ignored) {}
    }

    void screenOff() {
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Exception ignored) {}
        performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
    }

    void scan(String path) {
        if (path == null) return;
        String low = path.toLowerCase();
        String mime = low.endsWith(".mp4") ? "video/mp4" : (low.endsWith(".jpg") || low.endsWith(".jpeg")) ? "image/jpeg" : null;
        MediaScannerConnection.scanFile(getApplicationContext(), new String[]{path}, mime == null ? null : new String[]{mime}, null);
    }

    // Buka aplikasi. fresh=true → dari awal (task lama dibersihkan, pengganti "force-stop + buka");
    // fresh=false → bawa ke depan saja.
    boolean launch(String pkg, boolean fresh) {
        try {
            Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) return false;
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | (fresh ? Intent.FLAG_ACTIVITY_CLEAR_TASK : 0));
            startActivity(i);
            return true;
        } catch (Exception e) { return false; }
    }

    void setFocusedText(String s) {
        if (s == null) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        AccessibilityNodeInfo node = findEditableFocused(root);
        if (node == null) node = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (node != null) {
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, s);
            node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        }
    }

    private AccessibilityNodeInfo findEditableFocused(AccessibilityNodeInfo n) {
        if (n == null) return null;
        if (n.isFocused() && n.isEditable()) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = findEditableFocused(n.getChild(i));
            if (r != null) return r;
        }
        return null;
    }

    // ================= baca layar =================
    // XML gaya "uiautomator dump" (atribut text, content-desc, resource-id, class, clickable, bounds),
    // semua jendela dari yang paling atas → bawah (popup/dialog lebih dulu).
    String dumpXml() {
        StringBuilder sb = new StringBuilder("<?xml version='1.0' encoding='UTF-8'?><hierarchy>");
        List<AccessibilityNodeInfo> roots = new ArrayList<>();
        try {
            List<AccessibilityWindowInfo> ws = new ArrayList<>(getWindows());
            ws.sort((a, b) -> Integer.compare(b.getLayer(), a.getLayer()));
            for (AccessibilityWindowInfo w : ws) {
                AccessibilityNodeInfo r = w.getRoot();
                if (r != null) roots.add(r);
            }
        } catch (Exception ignored) {}
        if (roots.isEmpty()) {
            AccessibilityNodeInfo r = getRootInActiveWindow();
            if (r != null) roots.add(r);
        }
        for (AccessibilityNodeInfo r : roots) node(sb, r, 0);
        return sb.append("</hierarchy>").toString();
    }

    private void node(StringBuilder sb, AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 60) return;
        Rect b = new Rect();
        n.getBoundsInScreen(b);
        sb.append("<node text=\"").append(x(n.getText())).append('"')
          .append(" content-desc=\"").append(x(n.getContentDescription())).append('"')
          .append(" resource-id=\"").append(x(n.getViewIdResourceName())).append('"')
          .append(" class=\"").append(x(n.getClassName())).append('"')
          .append(" package=\"").append(x(n.getPackageName())).append('"')
          .append(" clickable=\"").append(n.isClickable()).append('"')
          .append(" bounds=\"[").append(b.left).append(',').append(b.top).append("][")
          .append(b.right).append(',').append(b.bottom).append("]\">");
        for (int i = 0; i < n.getChildCount(); i++) node(sb, n.getChild(i), depth + 1);
        sb.append("</node>");
    }

    private static String x(CharSequence cs) {
        if (cs == null) return "";
        String s = cs.toString();
        StringBuilder b = new StringBuilder(s.length());
        for (char c : s.toCharArray()) {
            switch (c) {
                case '&': b.append("&amp;"); break;
                case '<': b.append("&lt;"); break;
                case '>': b.append("&gt;"); break;
                case '"': b.append("&quot;"); break;
                case '\n': b.append("&#10;"); break;
                default: if (c >= 0x20) b.append(c);
            }
        }
        return b.toString();
    }

    String focusJson() {
        String pkg = focusPkg, cls = focusCls;
        try {
            AccessibilityNodeInfo r = getRootInActiveWindow();
            if (r != null && r.getPackageName() != null) pkg = r.getPackageName().toString();
        } catch (Exception ignored) {}
        return "{\"pkg\":\"" + LinkServer.esc(pkg) + "\",\"cls\":\"" + LinkServer.esc(cls) + "\"}";
    }

    // Screenshot lewat Aksesibilitas (Android 11+). Return PNG atau null.
    byte[] screenshotPng() {
        if (Build.VERSION.SDK_INT < 30) return null;
        final byte[][] out = new byte[1][];
        final CountDownLatch latch = new CountDownLatch(1);
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, Executors.newSingleThreadExecutor(), new TakeScreenshotCallback() {
                @Override public void onSuccess(ScreenshotResult res) {
                    try {
                        Bitmap hw = Bitmap.wrapHardwareBuffer(res.getHardwareBuffer(), res.getColorSpace());
                        if (hw != null) {
                            Bitmap bmp = hw.copy(Bitmap.Config.ARGB_8888, false);
                            ByteArrayOutputStream bos = new ByteArrayOutputStream();
                            bmp.compress(Bitmap.CompressFormat.PNG, 100, bos);
                            out[0] = bos.toByteArray();
                            bmp.recycle();
                            hw.recycle();
                        }
                        res.getHardwareBuffer().close();
                    } catch (Exception ignored) {}
                    latch.countDown();
                }
                @Override public void onFailure(int code) { latch.countDown(); }
            });
            latch.await(8, TimeUnit.SECONDS);
        } catch (Exception ignored) {}
        return out[0];
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e != null && e.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            if (e.getPackageName() != null) focusPkg = e.getPackageName().toString();
            if (e.getClassName() != null) focusCls = e.getClassName().toString();
        }
    }

    @Override public void onInterrupt() {}

    // Layar mati → HP tidur (CPU & WiFi hemat daya) dan PC tak bisa menghubungi Tap Server.
    // Tahan CPU + WiFi tetap siaga selama layanan aktif (HP posting idealnya sambil dicas).
    private PowerManager.WakeLock cpuLock;
    private WifiManager.WifiLock wifiLock;
    private void holdAwake(boolean on) {
        try {
            if (on) {
                if (cpuLock == null) {
                    cpuLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tapper:link");
                    cpuLock.setReferenceCounted(false);
                }
                cpuLock.acquire();
                if (wifiLock == null) {
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
                    wifiLock = wm.createWifiLock(Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF, "tapper:link");
                    wifiLock.setReferenceCounted(false);
                }
                wifiLock.acquire();
            } else {
                if (cpuLock != null && cpuLock.isHeld()) cpuLock.release();
                if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public boolean onUnbind(Intent i) {
        holdAwake(false);
        if (rx != null) { try { unregisterReceiver(rx); } catch (Exception ignored) {} rx = null; }
        if (link != null) { link.stop(); link = null; }
        return super.onUnbind(i);
    }
}
