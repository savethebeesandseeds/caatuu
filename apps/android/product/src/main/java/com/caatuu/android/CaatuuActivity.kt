package com.caatuu.android

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import java.io.ByteArrayInputStream

class CaatuuActivity : ComponentActivity() {
    private lateinit var appRoot: FrameLayout
    private lateinit var webView: WebView
    private lateinit var bridge: ProductBridge
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
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = false
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            safeBrowsingEnabled = true
        }

        val courseRegistry = BundledCourseRegistry.load(
            applicationContext,
            BuildConfig.CAATUU_COURSE_BUNDLE_ASSET,
        )
        val courseRuntimes = courseRegistry.courses.associate { course ->
            val providers = NativeProviderConfiguration.fromBundled(course.nativeProviders)
            providers.requireMatches(course.capabilities, course.targetLanguage.speechLocale)
            val vectorDatabaseManager = providers.embeddings?.let { provider ->
                VectorDatabaseManager(
                    applicationContext,
                    catalogAssetPath = provider.catalogAsset,
                )
            }
            val dictionaryManager = providers.dictionary?.let { provider ->
                DictionaryManager(
                    applicationContext,
                    catalogAssetPath = provider.catalogAsset,
                )
            }
            val speechManager = providers.speech?.let { provider ->
                AndroidSpeechManager(
                    applicationContext,
                    configuredLocaleTag = provider.locale,
                    targetLanguageLabel = course.targetLanguage.label,
                )
            }
            course.id to ProductCourseRuntime(
                course = course,
                vectorDatabaseManager = vectorDatabaseManager,
                dictionaryManager = dictionaryManager,
                staticAssetManager = StaticAssetManager(
                    applicationContext,
                    manifestAssetPath = "${course.assetPrefix}/setup-assets.json",
                    courseAssetPrefix = course.assetPrefix,
                    requireNativeAssets = false,
                ),
                speechManager = speechManager,
            )
        }
        NativeArtifactContract.requireCompatibleSharedStorage(
            courseRuntimes.values.flatMap { runtime ->
                buildList {
                    addAll(runtime.vectorDatabaseManager?.storageArtifacts(runtime.course.id).orEmpty())
                    addAll(runtime.dictionaryManager?.storageArtifacts(runtime.course.id).orEmpty())
                    addAll(runtime.staticAssetManager.storageArtifacts(runtime.course.id))
                }
            },
        )
        bridge = ProductBridge(
            activity = this,
            webView = webView,
            courseRegistry = courseRegistry,
            courseRuntimes = courseRuntimes,
            appUpdateManager = AppUpdateManager(applicationContext),
            onThemeChanged = { theme -> applySystemTheme(theme) },
        )

        val assetClient = CaatuuAssetClient(
            context = this,
            courseRegistry = courseRegistry,
            vectorDatabaseManagers = courseRuntimes.mapNotNull { (courseId, runtime) ->
                runtime.vectorDatabaseManager?.let { courseId to it }
            }.toMap(),
            staticAssetManagers = courseRuntimes.mapValues { (_, runtime) ->
                runtime.staticAssetManager
            },
        )
        webView.webViewClient = assetClient
        webView.addJavascriptInterface(bridge, "CaatuuAndroid")
        webView.loadUrl(assetClient.startUrl)

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
        val preferences = getSharedPreferences(WEBVIEW_RUNTIME_PREFERENCES, Context.MODE_PRIVATE)
        val previousVersion = preferences.getInt(VERSION_CODE_KEY, -1)
        val packageLastUpdateTime = packageManager.getPackageInfo(packageName, 0).lastUpdateTime
        val previousPackageUpdateTime = preferences.getLong(PACKAGE_UPDATE_TIME_KEY, -1L)
        if (
            previousVersion == BuildConfig.VERSION_CODE &&
            previousPackageUpdateTime == packageLastUpdateTime
        ) {
            return
        }

        webView.clearCache(true)
        webView.clearHistory()
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        preferences.edit()
            .putInt(VERSION_CODE_KEY, BuildConfig.VERSION_CODE)
            .putLong(PACKAGE_UPDATE_TIME_KEY, packageLastUpdateTime)
            .apply()
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
            if (webView.canGoBack()) webView.goBack() else finish()
        }
    }

    override fun onPause() {
        if (::bridge.isInitialized) bridge.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::bridge.isInitialized) bridge.onResume()
    }

    override fun onDestroy() {
        if (::bridge.isInitialized) bridge.destroy()
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val SYSTEM_THEME_PREFERENCES = "caatuu-system-theme"
        const val SYSTEM_THEME_KEY = "theme"
        const val WEBVIEW_RUNTIME_PREFERENCES = "caatuu-webview-runtime"
        const val VERSION_CODE_KEY = "versionCode"
        const val PACKAGE_UPDATE_TIME_KEY = "packageLastUpdateTime"
        const val LIGHT_THEME = "light"
        const val DARK_THEME = "dark"
        val LIGHT_SYSTEM_BAR_COLOR = Color.rgb(247, 244, 238)
        val DARK_SYSTEM_BAR_COLOR = Color.rgb(21, 26, 24)
    }
}
