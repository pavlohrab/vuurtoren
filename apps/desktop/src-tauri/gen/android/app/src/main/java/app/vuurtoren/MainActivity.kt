package app.vuurtoren

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  /** The system bars and cutout in CSS pixels, as JSON: {"top":…,"right":…,"bottom":…,"left":…}. */
  @Volatile private var insets = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}"

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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

  private inner class InsetsBridge {
    @JavascriptInterface fun get(): String = insets
  }
}
