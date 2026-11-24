package app.vuurtoren

import android.content.Intent
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  /** The system bars and cutout in CSS pixels, as JSON: {"top":…,"right":…,"bottom":…,"left":…}. */
  @Volatile private var insets = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}"

  /** A text or link shared to Vuurtoren from another app, until the page takes it. */
  @Volatile private var shared: String? = null
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    readShare(intent)
  }

  /** Shared while the app is open: keep it and tell the page (apps/web/src/platform/share.ts). */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (readShare(intent)) {
      webView?.post {
        webView?.evaluateJavascript("window.__vuurtorenShare && window.__vuurtorenShare()", null)
      }
    }
  }

  /** Keep the text of a "Share" (ACTION_SEND, text/plain), with its subject when separate. */
  private fun readShare(intent: Intent?): Boolean {
    if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return false
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()
    if (text.isNullOrEmpty()) return false
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()
    shared = if (!subject.isNullOrEmpty() && !text.contains(subject)) "$subject\n$text" else text
    return true
  }

  /**
   * Edge to edge: the page runs under the status bar and the gesture handle. Not every WebView
   * reports those as `env(safe-area-inset-*)`, so the page also gets them from here: read once
   * at start (`window.VuurtorenInsets.get()`) and pushed when they change (rotation, a
   * navigation-mode switch) through `window.__vuurtorenInsets`. The page uses the larger of
   * the two (`--safe-*` in packages/ui/src/styles.css).
   */
  override fun onWebViewCreate(webView: WebView) {
    // A card says its word as it shows, without a tap: the WebView would block that sound.
    webView.settings.mediaPlaybackRequiresUserGesture = false
    webView.addJavascriptInterface(InsetsBridge(), "VuurtorenInsets")
    webView.addJavascriptInterface(ShareBridge(), "VuurtorenShare")
    webView.addJavascriptInterface(TtsBridge(), "VuurtorenTts")
    this.webView = webView
    startTts()
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
      val bars =
        windowInsets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
      val density = view.resources.displayMetrics.density
      fun css(px: Int) = Math.round(px / density)
      val next =
        "{\"top\":${css(bars.top)},\"right\":${css(bars.right)}," +
          "\"bottom\":${css(bars.bottom)},\"left\":${css(bars.left)}}"
      if (next != insets) {
        insets = next
        view.post {
          (view as WebView).evaluateJavascript(
            "window.__vuurtorenInsets && window.__vuurtorenInsets($next)",
            null,
          )
        }
      }
      // The WebView's own handling (its env() values where it has them) stays as it was.
      ViewCompat.onApplyWindowInsets(view, windowInsets)
    }
    ViewCompat.requestApplyInsets(webView)
  }

  /**
   * Android's own text-to-speech for the Dutch voice: the WebView has no speechSynthesis, so
   * without a server (no recordings) the phone was silent. apps/web/src/platform/androidSpeech.ts
   * turns this into speechSynthesis for the page.
   */
  private var tts: TextToSpeech? = null
  @Volatile private var dutch = false

  private fun js(code: String) {
    webView?.post { webView?.evaluateJavascript(code, null) }
  }

  private fun startTts() {
    if (tts != null) return
    tts = TextToSpeech(this) { status ->
      val engine = tts
      if (status == TextToSpeech.SUCCESS && engine != null) {
        val nl = engine.setLanguage(Locale("nl", "NL"))
        dutch = nl != TextToSpeech.LANG_MISSING_DATA && nl != TextToSpeech.LANG_NOT_SUPPORTED
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(id: String) {}
          override fun onDone(id: String) = js("window.__vuurtorenTtsDone && window.__vuurtorenTtsDone(${org.json.JSONObject.quote(id)}, true)")
          @Deprecated("Deprecated in Java")
          override fun onError(id: String) = js("window.__vuurtorenTtsDone && window.__vuurtorenTtsDone(${org.json.JSONObject.quote(id)}, false)")
          override fun onStop(id: String, interrupted: Boolean) = js("window.__vuurtorenTtsDone && window.__vuurtorenTtsDone(${org.json.JSONObject.quote(id)}, true)")
        })
      }
      js("window.__vuurtorenTtsReady && window.__vuurtorenTtsReady($dutch)")
    }
  }

  override fun onDestroy() {
    tts?.shutdown()
    tts = null
    super.onDestroy()
  }

  private inner class TtsBridge {
    /** A Dutch voice is installed and ready. */
    @JavascriptInterface fun hasDutch(): Boolean = dutch

    /** Say `text` (replacing anything still speaking); `done` is reported by id. */
    @JavascriptInterface
    fun speak(id: String, text: String, rate: Float) {
      val engine = tts ?: return
      engine.setSpeechRate(rate.coerceIn(0.3f, 2.5f))
      engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
    }

    @JavascriptInterface fun stop() {
      tts?.stop()
    }
  }

  private inner class ShareBridge {
    /** The shared text, once (empty when there is none). */
    @JavascriptInterface
    fun take(): String {
      val text = shared ?: ""
      shared = null
      return text
    }
  }

  private inner class InsetsBridge {
    @JavascriptInterface fun get(): String = insets

    /**
     * The page's theme, for the clock and icons in the status bar and the gesture handle:
     * edge to edge they follow the phone's theme, so a dark page on a light phone got black
     * icons on black. Called by apps/web/src/theme.ts whenever the theme changes.
     */
    @JavascriptInterface
    fun setDarkBars(dark: Boolean) {
      runOnUiThread {
        val bars = WindowCompat.getInsetsController(window, window.decorView)
        bars.isAppearanceLightStatusBars = !dark
        bars.isAppearanceLightNavigationBars = !dark
      }
    }
  }
}
