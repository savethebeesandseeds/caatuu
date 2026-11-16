package com.caatuu.android

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Process
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/** Uses a user-granted document URI without enabling WebView file/content navigation. */
internal class CaatuuFileChooser(private val activity: ComponentActivity) : WebChromeClient() {
    private val request = FileSelectionRequest<Array<Uri>>()
    private var requestingView: WebView? = null
    private val launcher = activity.registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val view = requestingView
        requestingView = null
        val granted = uri != null && activity.checkUriPermission(
            uri, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION,
        ) == PackageManager.PERMISSION_GRANTED
        val result = uri?.takeIf {
            FileSelectionPolicy.trustedPage(view?.url) &&
                FileSelectionPolicy.allowedDocument(it.scheme, it.authority, activity.packageName + ".files", granted)
        }
        request.finish(result?.let { arrayOf(it) })
    }

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
    ): Boolean {
        if (!FileSelectionPolicy.trustedPage(webView.url) ||
            fileChooserParams.mode != FileChooserParams.MODE_OPEN ||
            fileChooserParams.isCaptureEnabled
        ) {
            filePathCallback.onReceiveValue(null)
            return true
        }
        if (!request.begin { filePathCallback.onReceiveValue(it) }) return true
        requestingView = webView
        try {
            launcher.launch(FileSelectionPolicy.acceptedMimeTypes(fileChooserParams.acceptTypes))
        } catch (_: ActivityNotFoundException) {
            cancel()
        } catch (_: SecurityException) {
            cancel()
        } catch (_: IllegalStateException) {
            cancel()
        }
        return true
    }

    private fun cancel() {
        requestingView = null
        request.finish(null)
    }

    fun destroy() {
        requestingView = null
        request.destroy()
    }
}
