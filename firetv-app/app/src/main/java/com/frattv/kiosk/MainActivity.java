package com.frattv.kiosk;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.RenderProcessGoneDetail;
import android.widget.EditText;
import android.widget.FrameLayout;

/**
 * Full-screen kiosk: shows the house TV web page and keeps it running.
 * Remote: Menu (≡) = change the page address, Back = ignored (so nobody exits by accident).
 */
public class MainActivity extends Activity {
    /** true while House TV is the app on screen (the background service checks this) */
    public static volatile boolean isOnScreen = false;

    private static final long RETRY_MS = 15_000;              // retry after a network error
    private static final long DAILY_RELOAD_MS = 12L * 3600_000; // fresh start twice a day

    private WebView web;
    private FrameLayout root;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;

    private final Runnable retry = new Runnable() { public void run() { loadPage(); } };
    private final Runnable periodic = new Runnable() {
        public void run() { loadPage(); handler.postDelayed(this, DAILY_RELOAD_MS); }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("tv", MODE_PRIVATE);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(11, 18, 64));
        setContentView(root);
        createWebView();

        if (getUrl().isEmpty()) askForUrl();
        else loadPage();
        handler.postDelayed(periodic, DAILY_RELOAD_MS);
        KioskService.start(this);
    }

    private void createWebView() {
        if (web != null) { root.removeView(web); web.destroy(); }
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(11, 18, 64));
        web.setFocusable(false);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Page size = the screen size, no automatic zooming (the page scales itself to fit)
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) scheduleRetry();
            }
            @Override
            public void onReceivedError(WebView v, int code, String desc, String url) {
                scheduleRetry(); // older Fire OS versions
            }
            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                // the page crashed: rebuild it instead of letting the app die
                createWebView(); loadPage(); return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private String getUrl() {
        String saved = prefs.getString("url", "");
        return saved.isEmpty() ? BuildConfig.TV_URL : saved;
    }

    private void loadPage() {
        handler.removeCallbacks(retry);
        String url = getUrl();
        if (!url.isEmpty()) web.loadUrl(url);
    }

    private void scheduleRetry() {
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_MS);
    }

    private void askForUrl() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        String cur = getUrl();
        input.setText(cur.isEmpty() ? "https://" : cur);
        input.setSelection(input.getText().length());
        new AlertDialog.Builder(this)
            .setTitle("House TV page address")
            .setMessage("Example: https://frat-tv.yourname.workers.dev/tv")
            .setView(input)
            .setPositiveButton("Save", (d, w) -> {
                prefs.edit().putString("url", input.getText().toString().trim()).apply();
                loadPage();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) { askForUrl(); return true; }
        if (keyCode == KeyEvent.KEYCODE_BACK) return true;          // ignore Back
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) { loadPage(); return true; } // OK = refresh
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override protected void onResume() { super.onResume(); isOnScreen = true; web.onResume(); hideSystemUi(); }
    @Override protected void onPause() { isOnScreen = false; web.onPause(); super.onPause(); }
    @Override protected void onDestroy() { handler.removeCallbacksAndMessages(null); web.destroy(); super.onDestroy(); }
}
