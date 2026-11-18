package com.embypro.egglab;

import android.content.ContentValues;
import android.content.res.Resources;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * EmbyPro 原生壳
 * 1. 状态栏透明 + 布局延伸到状态栏下方：视频可以铺满全屏播放
 * 2. 返回键交给前端决定：前端逐层关闭界面，已在首页时按两次才退出
 * 3. 向网页暴露状态栏高度，供前端把顶部按钮下移，避免被状态栏遮挡
 * 4. v1.2.9：向网页暴露文件桥，设置备份导出为真实文件（存系统「下载」）
 */
public class MainActivity extends BridgeActivity {

    public class NativeUI {
        @JavascriptInterface
        public int statusBarHeight() {
            try {
                Resources res = getResources();
                int id = res.getIdentifier("status_bar_height", "dimen", "android");
                int px = id > 0 ? res.getDimensionPixelSize(id) : 0;
                // 前端用的是 CSS px（WebView 里 1 CSS px = 1dp），这里把物理像素换算成 dp，
                // 否则 3x 屏会把 24dp 的状态栏当成 72px，顶部按钮被顶到很下面。
                float density = res.getDisplayMetrics().density;
                return density > 0 ? Math.round(px / density) : px;
            } catch (Exception e) {
                return 0;
            }
        }
    }

    /**
     * v1.2.9：设置备份文件桥。
     * saveToDownloads(name, content)：把文本内容写成真实文件。
     * Android 10+ 写入 MediaStore.Downloads（无需存储权限），文件出现在
     * 系统相册文件管理器的「下载 / Download」目录，用户可直接查看/复制/分享。
     * Android 9 及以下写入应用外部私有目录 Android/data/com.embypro.egglab/files/。
     * 返回文件位置描述（失败返回空串）。
     */
    public class NativeFile {
        @JavascriptInterface
        public String saveToDownloads(String name, String content) {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    Uri uri = getContentResolver().insert(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return "";
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os == null) return "";
                    os.write(content.getBytes("UTF-8"));
                    os.close();
                    return "下载/Download/" + name;
                }
                File dir = getExternalFilesDir(null);
                if (dir == null) dir = getFilesDir();
                File f = new File(dir, name);
                FileOutputStream fo = new FileOutputStream(f);
                fo.write(content.getBytes("UTF-8"));
                fo.close();
                return f.getAbsolutePath();
            } catch (Exception e) {
                return "";
            }
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 状态栏透明，内容延伸到状态栏区域
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        // v1.2.11：导航栏也透明 —— 否则布局虽延伸到导航栏后面，但系统导航条仍是不透明色块，
        // 底部底色条（阴影）与物理底边之间看起来永远隔着一条「空挡」
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        // v1.2.15 第 5 项：彻底 edge-to-edge —— 仅 LAYOUT_HIDE_NAVIGATION 在部分机型
        // （手势导航 / 深色主题兼容层）上仍会给 WebView 预留导航栏高度，导致
        // 「底部图标距底 0」到不了物理底边。WindowCompat 是官方兼容实现，全 API 生效。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View decor = getWindow().getDecorView();
        // v1.2.10：加 LAYOUT_HIDE_NAVIGATION，窗口布局延伸到系统导航栏后面，
        // CSS 的 bottom:0 = 手机物理底边（此前底部图标/进度条「距底部 0」到不了屏幕边缘）
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);

        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.addJavascriptInterface(new NativeUI(), "EmbyXNativeUI");
                webView.addJavascriptInterface(new NativeFile(), "EmbyXNativeFile");
            }
        } catch (Exception ignored) {
        }

        // v1.2.13：接通 Service Worker。
        // Capacitor 里页面跑在 http://localhost，本地资源靠 WebViewClient.shouldInterceptRequest
        // 提供；但 SW 线程的请求默认不走该拦截，导致 sw.js 注册/加载一直静默失败、
        // 海报图片缓存「不完全生效」。这里给 SW 线程挂上同样的拦截：
        // 只拦截 localhost 本地资源，远端图片/视频由 SW 自己联网（缓存优先 + LRU 裁剪）。
        try {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)
                    && WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) {
                ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                        new ServiceWorkerClientCompat() {
                            @Override
                            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                                try {
                                    Uri u = request != null ? request.getUrl() : null;
                                    if (u != null && "localhost".equals(u.getHost())) {
                                        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                                        if (wv != null && getBridge().getWebViewClient() != null) {
                                            return getBridge().getWebViewClient()
                                                    .shouldInterceptRequest(wv, request);
                                        }
                                    }
                                } catch (Exception ignored) {
                                }
                                return null;
                            }
                        });
            }
        } catch (Exception ignored) {
        }
    }

    /**
     * 2.1.11：把音量键转发给网页（不拦截，系统音量照常变化）。
     * 网页端 window.__embyxVolumeKey('up'/'down') 收到后，若正在静音则自动解除静音。
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (event.getAction() == KeyEvent.ACTION_DOWN
                && (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            try {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) {
                    String dir = code == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
                    webView.evaluateJavascript(
                            "(function(){try{window.__embyxVolumeKey && window.__embyxVolumeKey('" + dir + "');}catch(e){}})()",
                            null);
                }
            } catch (Exception ignored) {
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        WebView webView = null;
        try {
            webView = getBridge() != null ? getBridge().getWebView() : null;
        } catch (Exception ignored) {
        }

        if (webView == null) {
            super.onBackPressed();
            return;
        }

        webView.evaluateJavascript(
                "(function(){try{return (window.__embyxBack && window.__embyxBack()) || 'exit';}catch(e){return 'exit';}})()",
                value -> {
                    if (value == null || value.contains("exit")) {
                        finish();
                    }
                });
    }
}
