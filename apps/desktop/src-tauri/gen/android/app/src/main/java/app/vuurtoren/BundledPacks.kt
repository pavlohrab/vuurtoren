package app.vuurtoren

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.io.FileNotFoundException

/**
 * The dictionary the APK carries (`assets/packs/dictionary-nl.tar.gz`, put there by the
 * `vuurtorenPacks` Gradle task when the archive was at hand at build time). At first start it
 * is copied next to where the pack lives (`<app data>/packs/dictionary-nl.bundled.tar.gz`); the
 * Rust side (`dictionary.rs`, `unpack_bundled`) checks it against `packs.json`, unpacks it and
 * removes the copy. A build without the archive has nothing to copy and the app downloads the
 * dictionary instead.
 */
object BundledPacks {
  private const val ASSET = "packs/dictionary-nl.tar.gz"
  private const val PACK = "dictionary-nl.sqlite"
  private const val COPY = "dictionary-nl.bundled.tar.gz"

  /** Tauri's app data folder on Android (its PathPlugin): the app's data directory. */
  private fun appData(context: Context): File =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) context.dataDir
    else File(context.applicationInfo.dataDir)

  /** Copy the archive out once (before Tauri starts, so the Rust side finds it at setup). */
  fun copyOut(context: Context) {
    val packs = File(appData(context), "packs")
    val target = File(packs, COPY)
    if (File(packs, PACK).exists() || target.exists()) return
    try {
      context.assets.open(ASSET).use { input ->
        packs.mkdirs()
        val part = File(packs, "$COPY.part")
        part.outputStream().use { input.copyTo(it, 1 shl 16) }
        if (!part.renameTo(target)) part.delete()
      }
    } catch (_: FileNotFoundException) {
      // This build carries no dictionary: the app downloads it.
    } catch (e: Exception) {
      Log.w("Vuurtoren", "The dictionary in the app could not be copied", e)
    }
  }
}
