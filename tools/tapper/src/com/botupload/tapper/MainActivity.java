package com.botupload.tapper;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.accessibility.AccessibilityManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.List;

/**
 * Layar Tap Server: status layanan + KODE PASANGAN untuk menghubungkan PC lewat WiFi (tanpa kabel).
 */
public class MainActivity extends Activity {
    private TextView status, linkInfo, codeView, bgView;
    private Button bgBtn;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable refresher = new Runnable() {
        @Override public void run() { refresh(); handler.postDelayed(this, 2000); }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (22 * d);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(pad, pad, pad, pad);

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Color.parseColor("#111827"));
        sv.addView(root);

        root.addView(text("Tap Server", 26, Color.WHITE, true));
        root.addView(text("Pembantu posting Shopee Video dari aplikasi Bot Auto Upload di PC — tanpa kabel.", 14, Color.parseColor("#9CA3AF"), false));

        status = text("", 18, Color.WHITE, true);
        status.setPadding(0, pad, 0, pad / 2);
        root.addView(status);

        // Kartu kode pasangan
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(pad, pad / 2, pad, pad / 2);
        card.setBackgroundColor(Color.parseColor("#1F2937"));
        card.addView(text("Kode pasangan untuk PC", 13, Color.parseColor("#9CA3AF"), false));
        codeView = text("------", 40, Color.parseColor("#34D399"), true);
        codeView.setLetterSpacing(0.15f);
        card.addView(codeView);
        linkInfo = text("", 13, Color.parseColor("#D1D5DB"), false);
        card.addView(linkInfo);
        root.addView(card);

        // Kartu izin MIUI: SEMUA harus diizinkan agar posting otomatis lancar
        bgView = text("", 14, Color.WHITE, false);
        bgView.setGravity(Gravity.START);
        bgView.setPadding(pad / 2, pad / 2, pad / 2, pad / 2);
        bgView.setBackgroundColor(Color.parseColor("#1F2937"));
        LinearLayout.LayoutParams bgLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        bgLp.topMargin = pad / 2;
        bgView.setLayoutParams(bgLp);
        root.addView(bgView);
        bgBtn = button("Izinkan SEMUA izin (Izin lainnya)", this::openBgPermission);
        root.addView(bgBtn);

        root.addView(button("Buat kode baru", () -> { LinkServer.newPairCode(this); refresh(); }));
        root.addView(button("Putuskan semua PC yang terhubung", () -> { LinkServer.clearTokens(this); refresh(); }));
        root.addView(button("Buka Aksesibilitas", () -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))));
        root.addView(button("Buka Setelan Aplikasi (Mulai otomatis / Baterai)", () ->
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())))));

        TextView tips = text("\nCara menghubungkan:\n1. HP & PC di WiFi yang sama.\n2. Layanan harus AKTIF (Aksesibilitas).\n3. Di aplikasi PC: Kelola Akun → Hubungkan HP Shopee → Lewat WiFi → masukkan kode di atas.\n\nAgar tidak dimatikan HP:\n• Mulai otomatis: ON\n• Penghemat baterai: Tidak ada batasan\n• Gembok Tap Server di daftar aplikasi terbaru\n\nHanya PC yang tahu kode ini yang bisa mengendalikan HP.", 13, Color.parseColor("#D1D5DB"), false);
        tips.setGravity(Gravity.START);
        root.addView(tips);

        setContentView(sv);

        // Android 9 ke bawah: izin penyimpanan untuk menyimpan video kiriman PC ke Galeri
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 1);
        }
    }

    private TextView text(String s, float size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String label, Runnable onClick) {
        Button bt = new Button(this);
        bt.setText(label);
        bt.setAllCaps(false);
        bt.setOnClickListener(v -> onClick.run());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (8 * getResources().getDisplayMetrics().density);
        bt.setLayoutParams(lp);
        return bt;
    }

    /** MIUI: izin "Tampilkan jendela pop-up saat berjalan di latar belakang" (AppOps 10021). HP lain: selalu true. */
    static boolean canStartFromBackground(Context c) {
        if (!"xiaomi".equalsIgnoreCase(Build.MANUFACTURER)) return true;
        try {
            AppOpsManager ops = (AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
            java.lang.reflect.Method m = AppOpsManager.class.getMethod("checkOpNoThrow", int.class, int.class, String.class);
            int r = (Integer) m.invoke(ops, 10021, android.os.Process.myUid(), c.getPackageName());
            return r == AppOpsManager.MODE_ALLOWED;
        } catch (Throwable t) { return true; }
    }

    // MIUI AppOps: 10017 pintasan layar utama, 10020 tampil di layar kunci, 10021 pop-up dari latar belakang.
    // -1 = tidak bisa dicek (HP non-Xiaomi / API tertutup).
    static int miuiOp(Context c, int op) {
        if (!"xiaomi".equalsIgnoreCase(Build.MANUFACTURER)) return -1;
        try {
            AppOpsManager ops = (AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
            java.lang.reflect.Method m = AppOpsManager.class.getMethod("checkOpNoThrow", int.class, int.class, String.class);
            return ((Integer) m.invoke(ops, op, android.os.Process.myUid(), c.getPackageName())) == AppOpsManager.MODE_ALLOWED ? 1 : 0;
        } catch (Throwable t) { return -1; }
    }

    private void refreshPerms() {
        boolean xiaomi = "xiaomi".equalsIgnoreCase(Build.MANUFACTURER);
        if (!xiaomi) { bgView.setVisibility(android.view.View.GONE); bgBtn.setVisibility(android.view.View.GONE); return; }
        int sc = miuiOp(this, 10017), lock = miuiOp(this, 10020), bg = miuiOp(this, 10021);
        boolean missing = sc == 0 || lock == 0 || bg == 0;
        StringBuilder sb = new StringBuilder();
        sb.append(missing ? "⚠ Izinkan SEMUA izin di bawah ini:\n" : "Izin Tap Server (pastikan SEMUA aktif):\n");
        sb.append(mark(sc)).append(" Pintasan Layar utama\n");
        sb.append(mark(lock)).append(" Tampil di Layar kunci\n");
        sb.append(mark(bg)).append(" Menampilkan jendela pop-up saat berjalan di latar belakang\n");
        sb.append("• Notifikasi permanen\n\nKetuk tombol di bawah → Izin lainnya → aktifkan semuanya.");
        bgView.setText(sb.toString());
        bgView.setTextColor(missing ? Color.parseColor("#FBBF24") : Color.parseColor("#D1D5DB"));
    }
    private static String mark(int v) { return v == 1 ? "✅" : v == 0 ? "❌" : "•"; }

    private void openBgPermission() {
        try {   // halaman "Izin lainnya" MIUI
            Intent i = new Intent("miui.intent.action.APP_PERM_EDITOR");
            i.setClassName("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity");
            i.putExtra("extra_pkgname", getPackageName());
            startActivity(i);
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        }
    }

    private boolean serviceOn() {
        try {
            AccessibilityManager am = (AccessibilityManager) getSystemService(ACCESSIBILITY_SERVICE);
            List<AccessibilityServiceInfo> list = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
            for (AccessibilityServiceInfo i : list) {
                if (i.getId() != null && i.getId().startsWith(getPackageName())) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    private void refresh() {
        boolean on = serviceOn();
        status.setText(on ? "✅ Layanan AKTIF" : "❌ Layanan MATI\nKetuk \"Buka Aksesibilitas\" → Tap Server → aktifkan");
        status.setTextColor(on ? Color.parseColor("#34D399") : Color.parseColor("#F87171"));
        refreshPerms();
        codeView.setText(LinkServer.pairCode(this));
        String ip = LinkServer.wifiIp();
        int port = LinkServer.activePort(this);
        int pcs = LinkServer.tokens(this).size();
        if (!on) linkInfo.setText("Aktifkan layanan dulu agar PC bisa menemukan HP ini.");
        else if (ip.isEmpty()) linkInfo.setText("HP belum tersambung WiFi.");
        else linkInfo.setText("Alamat HP: " + ip + (port > 0 ? ":" + port : "") + "\nPC terhubung: " + pcs);
    }

    @Override protected void onResume() { super.onResume(); handler.post(refresher); }
    @Override protected void onPause() { super.onPause(); handler.removeCallbacks(refresher); }
}
