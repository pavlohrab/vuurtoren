package app.vuurtoren

import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
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
    webView.addJavascriptInterface(LinksBridge(), "VuurtorenLinks")
    webView.addJavascriptInterface(ListenBridge(), "VuurtorenListen")
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

  /**
   * Android's own speech recognition, so "Say this sentence" works on the phone without a
   * server. One listen at a time. The result goes back to the page by id through
   * `window.__vuurtorenListenDone(id, text, error)`: text is what was heard ("" when nothing
   * matched), error is a short code or "". apps/web/src/platform/androidListen.ts uses it.
   */
  private var recognizer: SpeechRecognizer? = null
  private var listenId: String? = null

  /** Tell the page how listen `id` ended, once. */
  private fun listenDone(id: String, text: String, error: String) {
    if (listenId == id) listenId = null
    val q = org.json.JSONObject::quote
    js("window.__vuurtorenListenDone && window.__vuurtorenListenDone(${q(id)}, ${q(text)}, ${q(error)})")
  }

  /** Main thread only. Ends any listen still running, then listens once in Dutch. */
  private fun startListening(id: String) {
    listenId?.let { listenDone(it, "", "") }
    recognizer?.destroy()
    recognizer = null
    if (!SpeechRecognizer.isRecognitionAvailable(this)) {
      listenDone(id, "", "unavailable")
      return
    }
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      listenId = id
      requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO)) { granted ->
        // Stopped or replaced while the question was open: nothing to do.
        if (listenId != id) return@requestPermissions
        if (granted == true) {
          listenId = null
          startListening(id)
        } else {
          listenDone(id, "", "permission")
        }
      }
      return
    }
    val r = SpeechRecognizer.createSpeechRecognizer(this)
    recognizer = r
    listenId = id
    r.setRecognitionListener(object : RecognitionListener {
      override fun onResults(results: Bundle?) {
        val best = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
        finish(best?.trim() ?: "", "")
      }
      override fun onError(code: Int) = finish("", listenError(code))
      override fun onReadyForSpeech(params: Bundle?) {}
      override fun onBeginningOfSpeech() {}
      override fun onRmsChanged(rmsdB: Float) {}
      override fun onBufferReceived(buffer: ByteArray?) {}
      override fun onEndOfSpeech() {}
      override fun onPartialResults(partialResults: Bundle?) {}
      override fun onEvent(eventType: Int, params: Bundle?) {}

      /** Report once, and only for the listen this recognizer belongs to. */
      private fun finish(text: String, error: String) {
        if (recognizer !== r) return
        recognizer = null
        r.destroy()
        listenDone(id, text, error)
      }
    })
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, "nl-NL")
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "nl-NL")
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
    }
    r.startListening(intent)
  }

  /** Android's error numbers as the page's short codes. No speech heard is not an error. */
  private fun listenError(code: Int): String =
    when (code) {
      SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
      SpeechRecognizer.ERROR_CLIENT -> ""
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
      SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
      SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "network"
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "busy"
      SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language"
      SpeechRecognizer.ERROR_AUDIO -> "audio"
      else -> "other"
    }

  private inner class ListenBridge {
    /** The phone has a speech recognizer. */
    @JavascriptInterface
    fun available(): Boolean = SpeechRecognizer.isRecognitionAvailable(this@MainActivity)

    /** Listen once; the answer comes back by id. Android wants this on the main thread. */
    @JavascriptInterface
    fun start(id: String) {
      runOnUiThread { startListening(id) }
    }

    /** Stop listening now and give what was heard so far. */
    @JavascriptInterface
    fun stop() {
      runOnUiThread {
        val r = recognizer
        if (r != null) r.stopListening()
        // Still asking for the microphone: end it with nothing heard.
        else listenId?.let { listenDone(it, "", "") }
      }
    }
  }

  override fun onDestroy() {
    recognizer?.destroy()
    recognizer = null
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

  /**
   * Links that open a new tab (Support, dictionary sites, story credits) in the phone's browser.
   * The WebView ignores target="_blank" by itself, so these links did nothing.
   */
  private inner class LinksBridge {
    @JavascriptInterface
    fun open(url: String): Boolean {
      val uri = android.net.Uri.parse(url)
      if (uri.scheme !in setOf("http", "https", "mailto")) return false
      return try {
        startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
      } catch (e: android.content.ActivityNotFoundException) {
        false
      }
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
