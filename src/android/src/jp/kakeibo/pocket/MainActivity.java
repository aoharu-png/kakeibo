package jp.kakeibo.pocket;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.Window;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * Wraps the 家計簿 web app. All pages are served from the APK's assets under a
 * fixed https origin so localStorage, workers and WebAssembly behave like a normal
 * site. The WebView may only reach api.anthropic.com (receipt reading with the user's own key);
 * Updater separately downloads new app files from the public GitHub repo. No user data is sent anywhere.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int PICK = 41;

    private WebView web;
    private ValueCallback<Uri[]> pending;
    private Uri cameraUri;
    private String sharedText;
    private boolean pageReady;
    private Updater updater;
    private boolean checkedUpdate;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 21) w.setStatusBarColor(Color.rgb(0x2f, 0x4b, 0x8f));

        int shell = 0;
        try { shell = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; } catch (Exception ignored) { }
        updater = new Updater(this, shell);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                // Only Claude's API may go over the network (for receipt reading, when the user has set a key).
                if ("api.anthropic.com".equals(u.getHost())) return null;
                if (!HOST.equals(u.getHost())) {
                    // Block everything else (e.g. web fonts): the app works fully offline.
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Offline", new HashMap<String, String>(), null);
                }
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                try {
                    // A downloaded update wins over the copy bundled in the APK.
                    java.io.File f = updater.overlayFile(path.substring(1));
                    InputStream in = f != null ? new java.io.FileInputStream(f) : getAssets().open("www" + path);
                    Map<String, String> h = new HashMap<>();
                    h.put("Cache-Control", "no-cache");
                    h.put("Access-Control-Allow-Origin", "https://" + HOST);
                    return new WebResourceResponse(mime(path), "utf-8", 200, "OK", h, in);
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), null);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                deliverShared();
                if (!checkedUpdate) {
                    checkedUpdate = true;
                    updater.checkAsync(new Updater.Listener() {
                        @Override public void onResult(final String status, final int v) {
                            if ("none".equals(status) || "error".equals(status)) return;
                            runOnUiThread(new Runnable() {
                                @Override public void run() {
                                    web.evaluateJavascript("window.__update&&window.__update('" + status + "'," + v + ")", null);
                                }
                            });
                        }
                    });
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri u = Uri.parse(url);
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (pending != null) pending.onReceiveValue(null);
                pending = cb;
                boolean image = false;
                for (String t : params.getAcceptTypes()) if (t != null && t.startsWith("image")) image = true;

                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType(image ? "image/*" : "*/*");

                ArrayList<Intent> extra = new ArrayList<>();
                cameraUri = null;
                if (image) {
                    try {
                        ContentValues v = new ContentValues();
                        v.put(MediaStore.Images.Media.DISPLAY_NAME, "receipt_" + System.currentTimeMillis() + ".jpg");
                        v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                        if (Build.VERSION.SDK_INT >= 29) v.put("relative_path", "Pictures/Kakeibo");
                        cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                        if (cameraUri != null) {
                            Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                            cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                            cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            extra.add(cam);
                        }
                    } catch (Exception e) {
                        cameraUri = null;
                    }
                }
                Intent chooser = Intent.createChooser(pick, image ? "レシートの写真" : "明細ファイルを選ぶ");
                if (!extra.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra.toArray(new Intent[0]));
                try {
                    startActivityForResult(chooser, PICK);
                } catch (Exception e) {
                    pending = null;
                    cb.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });

        setContentView(web);
        if (state != null) web.restoreState(state);
        else web.loadUrl(START);
        takeShared(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        takeShared(intent);
        deliverShared();
    }

    // Text shared from Google Lens (or any app) opens the paste screen with it filled in.
    private void takeShared(Intent i) {
        if (i != null && Intent.ACTION_SEND.equals(i.getAction())) {
            CharSequence t = i.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (t != null && t.length() > 0) sharedText = t.toString();
        }
    }

    private void deliverShared() {
        if (!pageReady || sharedText == null) return;
        final String js = "setTimeout(function(){window.__shared&&window.__shared(" + org.json.JSONObject.quote(sharedText) + ")},300)";
        sharedText = null;
        web.evaluateJavascript(js, null);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req != PICK || pending == null) { super.onActivityResult(req, res, data); return; }
        Uri[] result = null;
        if (res == RESULT_OK) {
            Uri u = data != null ? data.getData() : null;
            if (u != null) {
                result = new Uri[]{u};
                discardCameraUri();
            } else if (cameraUri != null) {
                result = new Uri[]{cameraUri};
            }
        } else {
            discardCameraUri();
        }
        pending.onReceiveValue(result);
        pending = null;
    }

    private void discardCameraUri() {
        if (cameraUri != null) {
            try { getContentResolver().delete(cameraUri, null, null); } catch (Exception ignored) { }
            cameraUri = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.__back && window.__back()) ? 'y' : 'n'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (v == null || !v.contains("y")) MainActivity.super.onBackPressed();
            }
        });
    }

    private static String mime(String p) {
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }
}
