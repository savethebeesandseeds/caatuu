package com.caatuu.android

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebSettings
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import java.io.ByteArrayInputStream

class MainActivity : ComponentActivity() {
    private lateinit var appRoot: FrameLayout
    private lateinit var webView: WebView
    private lateinit var bridge: CaatuuBridge
    private var systemTheme = DARK_THEME
    private var backRequestInFlight = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        systemTheme = readPersistedSystemTheme()
        WindowCompat.enableEdgeToEdge(window)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        hardenServiceWorkers()
        appRoot = FrameLayout(this)
        webView = WebView(this)
        appRoot.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(appRoot)
        ViewCompat.setOnApplyWindowInsetsListener(appRoot) { _, insets ->
            val safeArea = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout(),
            )
            webView.updateLayoutParams<FrameLayout.LayoutParams> {
                leftMargin = safeArea.left
                topMargin = safeArea.top
                rightMargin = safeArea.right
                bottomMargin = safeArea.bottom
            }
            insets
        }
        ViewCompat.requestApplyInsets(appRoot)
        applySystemTheme(systemTheme, persist = false)
        resetWebViewStateAfterUpdate()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            safeBrowsingEnabled = true
        }

        bridge = CaatuuBridge(
            activity = this,
            webView = webView,
            modelManager = ModelManager(applicationContext),
            vectorDatabaseManager = VectorDatabaseManager(applicationContext),
            dictionaryManager = DictionaryManager(applicationContext),
            staticAssetManager = StaticAssetManager(applicationContext),
            appUpdateManager = AppUpdateManager(applicationContext),
            model = NativeCzechModel(applicationContext),
            onThemeChanged = { theme -> applySystemTheme(theme) },
        )

        webView.webViewClient = CaatuuAssetClient(this)
        webView.addJavascriptInterface(bridge, "CaatuuAndroid")
        webView.loadUrl(CaatuuAssetClient.START_URL)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                handleBackRequest()
            }
        })
    }

    private fun readPersistedSystemTheme(): String =
        normalizeTheme(
            getSharedPreferences(SYSTEM_THEME_PREFERENCES, Context.MODE_PRIVATE)
                .getString(SYSTEM_THEME_KEY, DARK_THEME),
        )

    private fun normalizeTheme(theme: String?): String =
        if (theme == LIGHT_THEME) LIGHT_THEME else DARK_THEME

    @Suppress("DEPRECATION")
    private fun applySystemTheme(theme: String, persist: Boolean = true) {
        val normalizedTheme = normalizeTheme(theme)
        systemTheme = normalizedTheme
        if (persist) {
            getSharedPreferences(SYSTEM_THEME_PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putString(SYSTEM_THEME_KEY, normalizedTheme)
                .apply()
        }

        val lightTheme = normalizedTheme == LIGHT_THEME
        val color = if (lightTheme) LIGHT_SYSTEM_BAR_COLOR else DARK_SYSTEM_BAR_COLOR
        if (::appRoot.isInitialized) appRoot.setBackgroundColor(color)
        if (::webView.isInitialized) webView.setBackgroundColor(color)
        window.decorView.setBackgroundColor(color)

        // Android 15+ draws transparent system bars. The themed root above is
        // therefore the visible bar background; these colors remain useful for
        // three-button navigation and pre-edge-to-edge Android versions.
        window.statusBarColor = color
        window.navigationBarColor = color
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.navigationBarDividerColor = color
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }

        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = lightTheme
            isAppearanceLightNavigationBars = lightTheme
        }
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
            return
        }

        webView.clearCache(true)
        webView.clearHistory()
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        prefs.edit().putInt("versionCode", BuildConfig.VERSION_CODE).apply()
    }

    private fun handleBackRequest() {
        if (!::webView.isInitialized) return finish()
        if (backRequestInFlight) return
        backRequestInFlight = true

        webView.evaluateJavascript(
            """
            (() => {
              try {
                if (window.CaatuuHandleAndroidBack && window.CaatuuHandleAndroidBack()) return true;
                return Boolean(
                  window.CaatuuChrome
                  && window.CaatuuChrome.handleAndroidBack
                  && window.CaatuuChrome.handleAndroidBack()
                );
              } catch (error) {
                return false;
              }
            })();
            """.trimIndent(),
        ) { handled ->
            backRequestInFlight = false
            if (handled == "true") return@evaluateJavascript
            if (webView.canGoBack()) {
                webView.goBack()
            } else {
                finish()
            }
        }
    }

    override fun onDestroy() {
        if (::bridge.isInitialized) bridge.destroy()
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val SYSTEM_THEME_PREFERENCES = "caatuu-system-theme"
        private const val SYSTEM_THEME_KEY = "theme"
        private const val LIGHT_THEME = "light"
        private const val DARK_THEME = "dark"
        private val LIGHT_SYSTEM_BAR_COLOR = Color.rgb(247, 244, 238)
        private val DARK_SYSTEM_BAR_COLOR = Color.rgb(21, 26, 24)
    }
}
