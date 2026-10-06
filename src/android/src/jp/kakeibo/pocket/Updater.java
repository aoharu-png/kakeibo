package jp.kakeibo.pocket;

import android.content.Context;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

/**
 * Over-the-air updates for the web part of the app.
 *
 * The repo publishes www/version.json: {"web": N, "minShell": M, "files": [{"path", "sha256"}]}.
 * Files that differ from what is bundled in the APK are downloaded, checked against their
 * SHA-256, and kept in an overlay folder that the WebView serves before the bundled assets.
 * The switch to a new version is a single folder rename, so a half-finished download can
 * never leave the app broken. Nothing is ever uploaded: this only downloads app files.
 */
public class Updater {
    public static final String BASE = "https://raw.githubusercontent.com/aoharu-png/kakeibo/main/www/";

    public interface Listener { void onResult(String status, int webVersion); }

    private final Context ctx;
    private final int shellVersion;

    public Updater(Context ctx, int shellVersion) {
        this.ctx = ctx;
        this.shellVersion = shellVersion;
    }

    public File overlayDir() { return new File(ctx.getFilesDir(), "www"); }

    /** The file to serve for a path, or null to fall back to the bundled asset. */
    public File overlayFile(String path) {
        File f = new File(overlayDir(), path);
        try {
            if (!f.getCanonicalPath().startsWith(overlayDir().getCanonicalPath() + File.separator)) return null;
        } catch (Exception e) { return null; }
        return f.isFile() ? f : null;
    }

    public int currentWebVersion() {
        JSONObject m = currentManifest();
        return m == null ? 0 : m.optInt("web", 0);
    }

    private JSONObject currentManifest() {
        try {
            File f = overlayFile("version.json");
            if (f != null) return new JSONObject(readAll(new FileInputStream(f)));
            return bundledManifest();
        } catch (Exception e) { return null; }
    }

    private JSONObject bundledManifest() {
        try { return new JSONObject(readAll(ctx.getAssets().open("www/version.json"))); }
        catch (Exception e) { return null; }
    }

    /** Runs on a background thread; reports "none", "updated", "shell" (new APK needed) or "error". */
    public void checkAsync(final Listener l) {
        new Thread(new Runnable() {
            @Override public void run() {
                String status; int v = currentWebVersion();
                try {
                    JSONObject remote = new JSONObject(new String(get(BASE + "version.json?t=" + System.currentTimeMillis()), "UTF-8"));
                    int rv = remote.optInt("web", 0);
                    if (rv <= v) status = "none";
                    else if (remote.optInt("minShell", 0) > shellVersion) { status = "shell"; v = rv; }
                    else { apply(remote); status = "updated"; v = rv; }
                } catch (Exception e) {
                    status = "error";
                }
                if (l != null) l.onResult(status, v);
            }
        }).start();
    }

    private void apply(JSONObject remote) throws Exception {
        Map<String, String> bundled = hashes(bundledManifest());
        File overlay = overlayDir();
        File staging = new File(ctx.getFilesDir(), "www_new");
        deleteTree(staging);
        if (!staging.mkdirs()) throw new Exception("mkdir");
        JSONArray files = remote.getJSONArray("files");
        for (int i = 0; i < files.length(); i++) {
            JSONObject f = files.getJSONObject(i);
            String path = f.getString("path"), sha = f.getString("sha256");
            if (path.contains("..") || path.startsWith("/")) throw new Exception("bad path");
            if (sha.equals(bundled.get(path))) continue;            // the APK already has this exact file
            File dest = new File(staging, path);
            dest.getParentFile().mkdirs();
            File old = new File(overlay, path);
            if (old.isFile() && sha.equals(sha256(new FileInputStream(old)))) {
                copy(new FileInputStream(old), new FileOutputStream(dest));
                continue;
            }
            byte[] data = get(BASE + path + "?v=" + sha.substring(0, 12));
            if (!sha.equals(sha256(new java.io.ByteArrayInputStream(data)))) throw new Exception("hash mismatch " + path);
            FileOutputStream out = new FileOutputStream(dest);
            out.write(data);
            out.close();
        }
        FileOutputStream mo = new FileOutputStream(new File(staging, "version.json"));
        mo.write(remote.toString().getBytes("UTF-8"));
        mo.close();
        File trash = new File(ctx.getFilesDir(), "www_old");
        deleteTree(trash);
        if (overlay.exists() && !overlay.renameTo(trash)) throw new Exception("swap");
        if (!staging.renameTo(overlay)) { trash.renameTo(overlay); throw new Exception("swap"); }
        deleteTree(trash);
    }

    private static Map<String, String> hashes(JSONObject m) {
        Map<String, String> out = new HashMap<>();
        if (m == null) return out;
        JSONArray a = m.optJSONArray("files");
        if (a == null) return out;
        for (int i = 0; i < a.length(); i++) {
            JSONObject f = a.optJSONObject(i);
            if (f != null) out.put(f.optString("path"), f.optString("sha256"));
        }
        return out;
    }

    private static byte[] get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(30000);
        c.setUseCaches(false);
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            copy(in, bo);
            return bo.toByteArray();
        } finally { c.disconnect(); }
    }

    private static String sha256(InputStream in) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[65536]; int n;
        while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        in.close();
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[65536]; int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close(); out.close();
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        copy(in, bo);
        return bo.toString("UTF-8");
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }
}
