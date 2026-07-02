package com.caatuu.android

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var bridge: CaatuuBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
        }

        bridge = CaatuuBridge(
            activity = this,
            webView = webView,
            modelManager = ModelManager(applicationContext),
            appUpdateManager = AppUpdateManager(applicationContext),
            model = NativeCzechModel(applicationContext),
        )

        webView.webViewClient = CaatuuAssetClient(this)
        webView.addJavascriptInterface(bridge, "CaatuuAndroid")
        webView.loadUrl(CaatuuAssetClient.START_URL)
    }

    @Deprecated("Deprecated by Android, still correct for this simple Activity shell.")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        if (::bridge.isInitialized) bridge.destroy()
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
