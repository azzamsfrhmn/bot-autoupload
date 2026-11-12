package com.botupload.tapper;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Path;
import android.media.MediaScannerConnection;
import android.os.Bundle;
import android.os.PowerManager;
import android.util.Base64;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * Tap server berbasis AccessibilityService.
 * Terima perintah lewat `am broadcast` (BUKAN injeksi event), jadi lolos blokir
 * INJECT_EVENTS di MIUI tanpa akun Mi. Aktifkan sekali di Setelan > Aksesibilitas.
 *
 * Contoh perintah dari ADB:
 *   am broadcast -a com.botupload.tapper.TAP   -p com.botupload.tapper --ei x 540 --ei y 1200
 *   am broadcast -a com.botupload.tapper.SWIPE -p com.botupload.tapper --ei x1 540 --ei y1 1800 --ei x2 540 --ei y2 600 --ei dur 400
 *   am broadcast -a com.botupload.tapper.TEXT  -p com.botupload.tapper --es msg "halo dunia"
 */
public class TapService extends AccessibilityService {

    private BroadcastReceiver rx;

    @Override
    public void onServiceConnected() {
        IntentFilter f = new IntentFilter();
        f.addAction("com.botupload.tapper.TAP");
        f.addAction("com.botupload.tapper.SWIPE");
        f.addAction("com.botupload.tapper.TEXT");
        f.addAction("com.botupload.tapper.SCAN");
        f.addAction("com.botupload.tapper.WAKE");
        f.addAction("com.botupload.tapper.SCREEN_OFF");
        rx = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                String a = i.getAction();
                if (a == null) return;
                if (a.endsWith(".TAP")) {
                    doTap(i.getIntExtra("x", 0), i.getIntExtra("y", 0));
                } else if (a.endsWith(".SWIPE")) {
                    doSwipe(i.getIntExtra("x1", 0), i.getIntExtra("y1", 0),
                            i.getIntExtra("x2", 0), i.getIntExtra("y2", 0),
                            i.getIntExtra("dur", 300));
                } else if (a.endsWith(".TEXT")) {
                    String b64 = i.getStringExtra("b64");
                    String txt = b64 != null
                            ? new String(Base64.decode(b64, Base64.DEFAULT), java.nio.charset.StandardCharsets.UTF_8)
                            : i.getStringExtra("msg");
                    setFocusedText(txt);
                } else if (a.endsWith(".SCAN")) {
                    scanMedia(c, i.getStringExtra("path"));
                } else if (a.endsWith(".WAKE")) {
                    acquireWake(c);
                    try {
                        Intent w = new Intent(c, WakeActivity.class);
                        w.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        c.startActivity(w);
                    } catch (Exception ignored) {}
                } else if (a.endsWith(".SCREEN_OFF")) {
                    releaseWake();
                    performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
                }
            }
        };
        registerReceiver(rx, f);
    }

    private void doTap(int x, int y) {
        Path p = new Path();
        p.moveTo(x, y);
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(p, 0, 60));
        dispatchGesture(b.build(), null, null);
    }

    private void doSwipe(int x1, int y1, int x2, int y2, int dur) {
        Path p = new Path();
        p.moveTo(x1, y1);
        p.lineTo(x2, y2);
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(p, 0, Math.max(50, dur)));
        dispatchGesture(b.build(), null, null);
    }

    private PowerManager.WakeLock wl;

    @SuppressWarnings("deprecation")
    private void acquireWake(Context c) {
        try {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            if (wl == null) {
                wl = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                        "tapper:wake");
                wl.setReferenceCounted(false);
            }
            if (!wl.isHeld()) wl.acquire(10 * 60 * 1000L); // auto-lepas maks 10 menit
        } catch (Exception ignored) {}
    }

    private void releaseWake() {
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Exception ignored) {}
    }

    private void scanMedia(Context c, String path) {
        if (path == null) return;
        String mime = path.toLowerCase().endsWith(".mp4") ? "video/mp4"
                : (path.toLowerCase().endsWith(".jpg") || path.toLowerCase().endsWith(".jpeg")) ? "image/jpeg" : null;
        MediaScannerConnection.scanFile(c.getApplicationContext(),
                new String[]{path}, mime == null ? null : new String[]{mime}, null);
    }

    private void setFocusedText(String s) {
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

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {}
    @Override public void onInterrupt() {}

    @Override
    public boolean onUnbind(Intent i) {
        if (rx != null) {
            try { unregisterReceiver(rx); } catch (Exception ignored) {}
            rx = null;
        }
        return super.onUnbind(i);
    }
}
