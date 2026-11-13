package com.botupload.tapper;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Server HTTP mini di dalam Tap Server: PC mengendalikan HP lewat WiFi (TANPA ADB / kabel).
 * Hidup selama layanan Aksesibilitas Tap Server aktif.
 *
 * Keamanan: semua perintah butuh header "X-Token". Token didapat dari POST /pair dengan
 * kode pasangan 6 digit yang tampil di layar Tap Server (hanya orang yang memegang HP tahu).
 *
 * Endpoint:
 *  GET  /info                         (tanpa token) identitas HP, layar, status
 *  POST /pair        {"code":"123456"} → {"token":...}
 *  POST /tap {"x","y"} | /swipe {x1,y1,x2,y2,dur} | /text {"text"} | /back | /home
 *  POST /wake | /screen-off | /launch {"pkg"} | /scan {"path"}
 *  GET  /dump        → XML gaya uiautomator (semua jendela, atas → bawah)
 *  GET  /screenshot  → PNG (Android 11+)
 *  GET  /focus       → {"pkg","cls"} jendela terdepan
 *  GET  /packages?names=a,b → {"a":true,...}
 *  PUT  /upload?name=x.mp4 (body = file) → simpan ke Galeri (DCIM/Camera)
 */
public class LinkServer {
    public static final int[] PORTS = {8765, 8766, 8767};
    static final String PREFS = "tapserver";

    private final TapService svc;
    private ServerSocket server;
    private Thread acceptThread;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private volatile boolean running;
    private int port = -1;

    LinkServer(TapService svc) { this.svc = svc; }

    // ---------- kode pasangan & token (dipakai juga oleh MainActivity) ----------
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static String pairCode(Context c) {
        SharedPreferences p = prefs(c);
        String code = p.getString("pairCode", null);
        if (code == null) code = newPairCode(c);
        return code;
    }
    static String newPairCode(Context c) {
        String code = String.format(Locale.US, "%06d", new SecureRandom().nextInt(1000000));
        prefs(c).edit().putString("pairCode", code).apply();
        return code;
    }
    static Set<String> tokens(Context c) { return new HashSet<>(prefs(c).getStringSet("tokens", Collections.emptySet())); }
    static void clearTokens(Context c) { prefs(c).edit().remove("tokens").apply(); }
    static int activePort(Context c) { return prefs(c).getInt("port", -1); }

    static String wifiIp() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    String h = a.getHostAddress();
                    if (h != null && !a.isLoopbackAddress() && h.indexOf(':') < 0
                            && (h.startsWith("192.168.") || h.startsWith("10.") || h.startsWith("172."))) return h;
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    // ---------- siklus hidup ----------
    synchronized void start() {
        if (running) return;
        for (int p : PORTS) {
            try { server = new ServerSocket(p); port = p; break; } catch (Exception ignored) {}
        }
        if (server == null) return;
        running = true;
        prefs(svc).edit().putInt("port", port).apply();
        acceptThread = new Thread(() -> {
            while (running) {
                try {
                    Socket s = server.accept();
                    pool.execute(() -> handle(s));
                } catch (Exception e) { if (!running) break; }
            }
        }, "TapLinkServer");
        acceptThread.start();
    }

    synchronized void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (Exception ignored) {}
        server = null;
        prefs(svc).edit().putInt("port", -1).apply();
    }

    // ---------- HTTP ----------
    private static String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) break;
        }
        if (c == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private void handle(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(120000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();
            String reqLine = readLine(in);
            if (reqLine == null) return;
            String[] parts = reqLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String full = parts[1];
            Map<String, String> headers = new HashMap<>();
            String h;
            while ((h = readLine(in)) != null && !h.isEmpty()) {
                int i = h.indexOf(':');
                if (i > 0) headers.put(h.substring(0, i).trim().toLowerCase(Locale.US), h.substring(i + 1).trim());
            }
            String pathOnly = full;
            Map<String, String> query = new HashMap<>();
            int q = full.indexOf('?');
            if (q >= 0) {
                pathOnly = full.substring(0, q);
                for (String kv : full.substring(q + 1).split("&")) {
                    int e = kv.indexOf('=');
                    if (e > 0) query.put(URLDecoder.decode(kv.substring(0, e), "UTF-8"), URLDecoder.decode(kv.substring(e + 1), "UTF-8"));
                }
            }
            long len = 0;
            try { len = Long.parseLong(headers.getOrDefault("content-length", "0")); } catch (Exception ignored) {}

            // /upload: body di-stream langsung ke Galeri (bisa puluhan MB)
            if ("PUT".equals(method) && "/upload".equals(pathOnly)) {
                if (!authed(headers)) { send(out, 401, "application/json", json("error", "unauthorized")); return; }
                String name = query.getOrDefault("name", "shp_" + System.currentTimeMillis() + ".mp4");
                String res = saveUpload(name, in, len);
                send(out, res.startsWith("{\"ok\":true") ? 200 : 500, "application/json", res.getBytes(StandardCharsets.UTF_8));
                return;
            }

            byte[] body = new byte[(int) Math.min(len, 2 * 1024 * 1024)];
            int off = 0;
            while (off < body.length) { int r = in.read(body, off, body.length - off); if (r < 0) break; off += r; }
            String bodyStr = new String(body, 0, off, StandardCharsets.UTF_8);

            if ("GET".equals(method) && "/info".equals(pathOnly)) { send(out, 200, "application/json", info().getBytes(StandardCharsets.UTF_8)); return; }
            if ("POST".equals(method) && "/pair".equals(pathOnly)) { send(out, 200, "application/json", pair(bodyStr).getBytes(StandardCharsets.UTF_8)); return; }
            if (!authed(headers)) { send(out, 401, "application/json", json("error", "unauthorized")); return; }

            switch (pathOnly) {
                case "/tap":        svc.doTap(num(bodyStr, "x"), num(bodyStr, "y")); ok(out); return;
                case "/swipe":      svc.doSwipe(num(bodyStr, "x1"), num(bodyStr, "y1"), num(bodyStr, "x2"), num(bodyStr, "y2"), Math.max(50, num(bodyStr, "dur"))); ok(out); return;
                case "/text":       svc.setFocusedText(str(bodyStr, "text")); ok(out); return;
                case "/back":       svc.performGlobalAction(TapService.GLOBAL_ACTION_BACK); ok(out); return;
                case "/home":       svc.performGlobalAction(TapService.GLOBAL_ACTION_HOME); ok(out); return;
                case "/wake":       svc.wake(); ok(out); return;
                case "/screen-off": svc.screenOff(); ok(out); return;
                case "/scan":       svc.scan(str(bodyStr, "path")); ok(out); return;
                case "/launch":     send(out, 200, "application/json", json("ok", String.valueOf(svc.launch(str(bodyStr, "pkg"), num(bodyStr, "fresh") == 1)))); return;
                case "/dump":       send(out, 200, "text/xml; charset=utf-8", svc.dumpXml().getBytes(StandardCharsets.UTF_8)); return;
                case "/focus":      send(out, 200, "application/json", svc.focusJson().getBytes(StandardCharsets.UTF_8)); return;
                case "/packages":   send(out, 200, "application/json", packages(query.getOrDefault("names", "")).getBytes(StandardCharsets.UTF_8)); return;
                case "/screenshot": {
                    byte[] png = svc.screenshotPng();
                    if (png == null) send(out, 501, "application/json", json("error", "screenshot butuh Android 11+"));
                    else send(out, 200, "image/png", png);
                    return;
                }
                default: send(out, 404, "application/json", json("error", "not found"));
            }
        } catch (Exception ignored) {}
    }

    private boolean authed(Map<String, String> headers) {
        String t = headers.get("x-token");
        return t != null && !t.isEmpty() && tokens(svc).contains(t);
    }

    private String pair(String body) {
        String code = str(body, "code");
        if (code == null || !code.equals(pairCode(svc))) return "{\"ok\":false,\"error\":\"kode salah\"}";
        byte[] r = new byte[24];
        new SecureRandom().nextBytes(r);
        StringBuilder sb = new StringBuilder();
        for (byte b : r) sb.append(String.format("%02x", b));
        Set<String> t = tokens(svc);
        t.add(sb.toString());
        prefs(svc).edit().putStringSet("tokens", t).apply();
        newPairCode(svc);                      // kode sekali pakai → ganti setelah dipakai
        return "{\"ok\":true,\"token\":\"" + sb + "\"}";
    }

    private String info() {
        DisplayMetrics dm = new DisplayMetrics();
        try { ((WindowManager) svc.getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(dm); } catch (Exception ignored) {}
        PowerManager pm = (PowerManager) svc.getSystemService(Context.POWER_SERVICE);
        String devId = Settings.Secure.getString(svc.getContentResolver(), Settings.Secure.ANDROID_ID);
        return "{\"app\":\"tapserver\",\"version\":\"" + BuildInfo.VERSION + "\""
                + ",\"deviceId\":\"" + esc(devId) + "\""
                + ",\"model\":\"" + esc(Build.MODEL) + "\",\"brand\":\"" + esc(Build.MANUFACTURER) + "\""
                + ",\"android\":\"" + esc(Build.VERSION.RELEASE) + "\",\"sdk\":" + Build.VERSION.SDK_INT
                + ",\"width\":" + dm.widthPixels + ",\"height\":" + dm.heightPixels
                + ",\"screenOn\":" + (pm != null && pm.isInteractive())
                + ",\"screenshot\":" + (Build.VERSION.SDK_INT >= 30)
                + ",\"bgStart\":" + MainActivity.canStartFromBackground(svc)
                + ",\"ip\":\"" + wifiIp() + "\",\"port\":" + port + "}";
    }

    private String packages(String names) {
        StringBuilder sb = new StringBuilder("{");
        PackageManager pm = svc.getPackageManager();
        boolean first = true;
        for (String n : names.split(",")) {
            n = n.trim();
            if (n.isEmpty()) continue;
            boolean has;
            try { pm.getPackageInfo(n, 0); has = true; } catch (Exception e) { has = false; }
            if (!first) sb.append(',');
            sb.append('"').append(esc(n)).append("\":").append(has);
            first = false;
        }
        return sb.append('}').toString();
    }

    // Simpan file kiriman PC ke Galeri (DCIM/Camera) + pindai metadata agar muncul di galeri Shopee
    private String saveUpload(String name, InputStream in, long len) {
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        String mime = name.toLowerCase(Locale.US).endsWith(".mp4") ? "video/mp4" : "application/octet-stream";
        try {
            String path;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentResolver cr = svc.getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DCIM + "/Camera");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) return "{\"ok\":false,\"error\":\"insert gagal\"}";
                try (OutputStream os = cr.openOutputStream(uri)) { copy(in, os, len); }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, done, null, null);
                path = "";
                try (Cursor c = cr.query(uri, new String[]{MediaStore.MediaColumns.DATA}, null, null, null)) {
                    if (c != null && c.moveToFirst()) path = c.getString(0);
                } catch (Exception ignored) {}
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), "Camera");
                dir.mkdirs();
                File f = new File(dir, name);
                try (OutputStream os = new FileOutputStream(f)) { copy(in, os, len); }
                path = f.getAbsolutePath();
            }
            if (path != null && !path.isEmpty()) {
                MediaScannerConnection.scanFile(svc.getApplicationContext(), new String[]{path}, new String[]{mime}, null);
            }
            return "{\"ok\":true,\"path\":\"" + esc(path) + "\"}";
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"" + esc(String.valueOf(e.getMessage())) + "\"}";
        }
    }

    private static void copy(InputStream in, OutputStream os, long len) throws Exception {
        byte[] buf = new byte[64 * 1024];
        long left = len;
        while (left > 0) {
            int r = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (r < 0) break;
            os.write(buf, 0, r);
            left -= r;
        }
    }

    // ---------- util JSON sederhana ----------
    private static void ok(OutputStream out) throws Exception { send(out, 200, "application/json", "{\"ok\":true}".getBytes(StandardCharsets.UTF_8)); }
    private static byte[] json(String k, String v) { return ("{\"" + k + "\":\"" + esc(v) + "\"}").getBytes(StandardCharsets.UTF_8); }
    static String esc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') b.append("\\r");
            else if (c < 0x20) b.append(' ');
            else b.append(c);
        }
        return b.toString();
    }
    // ambil nilai "key":angka dari JSON datar
    static int num(String body, String key) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"" + key + "\"\\s*:\\s*(-?\\d+)").matcher(body);
        return m.find() ? Integer.parseInt(m.group(1)) : 0;
    }
    // ambil nilai "key":"teks" dari JSON datar (mendukung escape \" \\ \n \\uXXXX)
    static String str(String body, String key) {
        int i = body.indexOf("\"" + key + "\"");
        if (i < 0) return null;
        i = body.indexOf(':', i);
        if (i < 0) return null;
        i = body.indexOf('"', i);
        if (i < 0) return null;
        StringBuilder b = new StringBuilder();
        for (int j = i + 1; j < body.length(); j++) {
            char c = body.charAt(j);
            if (c == '"') return b.toString();
            if (c == '\\' && j + 1 < body.length()) {
                char n = body.charAt(++j);
                if (n == 'n') b.append('\n');
                else if (n == 'r') b.append('\r');
                else if (n == 't') b.append('\t');
                else if (n == 'u' && j + 4 < body.length()) { b.append((char) Integer.parseInt(body.substring(j + 1, j + 5), 16)); j += 4; }
                else b.append(n);
            } else b.append(c);
        }
        return b.toString();
    }

    private static void send(OutputStream out, int code, String type, byte[] data) throws Exception {
        String status = code == 200 ? "OK" : code == 401 ? "Unauthorized" : code == 404 ? "Not Found" : code == 501 ? "Not Implemented" : "Error";
        String head = "HTTP/1.1 " + code + " " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + data.length
                + "\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(data);
        out.flush();
    }
}
