package com.caatuu.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebSettings
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import java.io.ByteArrayInputStream

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var bridge: CaatuuBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        hardenServiceWorkers()
        webView = WebView(this)
        setContentView(webView)
        resetWebViewStateAfterUpdate()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
        }

        bridge = CaatuuBridge(
            activity = this,
            webView = webView,
            modelManager = ModelManager(applicationContext),
            vectorDatabaseManager = VectorDatabaseManager(applicationContext),
            staticAssetManager = StaticAssetManager(applicationContext),
            appUpdateManager = AppUpdateManager(applicationContext),
            model = NativeCzechModel(applicationContext),
        )

        webView.webViewClient = CaatuuAssetClient(this)
        webView.addJavascriptInterface(bridge, "CaatuuAndroid")
        webView.loadUrl(CaatuuAssetClient.START_URL)
    }

    private fun hardenServiceWorkers() {
        val controller = ServiceWorkerController.getInstance()
        controller.serviceWorkerWebSettings.apply {
            allowContentAccess = false
            allowFileAccess = false
            blockNetworkLoads = true
        }
        controller.setServiceWorkerClient(object : ServiceWorkerClient() {
            override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse =
                WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    403,
                    "Forbidden",
                    mapOf("Cache-Control" to "no-store"),
                    ByteArrayInputStream("Service workers are disabled in Caatuu Android.".toByteArray()),
                )
        })
    }

    private fun resetWebViewStateAfterUpdate() {
        val prefs = getSharedPreferences("caatuu-webview-runtime", Context.MODE_PRIVATE)
        val previousVersion = prefs.getInt("versionCode", -1)
        if (previousVersion == BuildConfig.VERSION_CODE) {
            webView.clearCache(true)
            return
        }

        webView.clearCache(true)
        webView.clearHistory()
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        prefs.edit().putInt("versionCode", BuildConfig.VERSION_CODE).apply()
    }

    @Deprecated("Deprecated by Android, still correct for this simple Activity shell.")
    override fun onBackPressed() {
        if (!::webView.isInitialized) {
            super.onBackPressed()
            return
        }

        webView.evaluateJavascript(
            """
            (() => {
              try {
                return Boolean(window.CaatuuHandleAndroidBack && window.CaatuuHandleAndroidBack());
              } catch (error) {
                return false;
              }
            })();
            """.trimIndent(),
        ) { handled ->
            if (handled == "true") return@evaluateJavascript
            if (webView.canGoBack()) {
                webView.goBack()
            } else {
                super.onBackPressed()
            }
        }
    }

    override fun onDestroy() {
        if (::bridge.isInitialized) bridge.destroy()
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
