package app.vuurtoren

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class SaveArgs {
    lateinit var name: String
    lateinit var key: String
}

@InvokeArg
class NameArgs {
    lateinit var name: String
}

/**
 * The sync key and the server's sync token in the Android Keystore (`src/mobile.rs` calls it;
 * `name` is "sync-key" or "sync-token", checked in `src/keys.rs`).
 *
 * An AES-256 key is made in the Android Keystore once and never leaves it; each secret is sealed
 * with it (AES-GCM) and the sealed bytes are kept in the app's private preferences
 * (`vuurtoren-keys`, excluded from backups: `res/xml/backup_rules.xml`). A backup restored on
 * another phone has neither, and the passphrase brings the key back there.
 */
@TauriPlugin
class KeystorePlugin(private val activity: Activity) : Plugin(activity) {
    private val alias = "vuurtoren-sync-wrap"
    private val prefsName = "vuurtoren-keys"

    private fun prefs() = activity.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun wrapKey(): SecretKey {
        (keyStore().getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    @Command
    fun save(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SaveArgs::class.java)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, wrapKey())
            val sealed = cipher.iv + cipher.doFinal(args.key.toByteArray(Charsets.US_ASCII))
            val ok = prefs().edit()
                .putString(args.name, Base64.encodeToString(sealed, Base64.NO_WRAP))
                .commit()
            if (!ok) throw IllegalStateException("the app's storage did not keep it")
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.javaClass.simpleName)
        }
    }

    @Command
    fun load(invoke: Invoke) {
        // No "key" in the answer: none is kept.
        val result = JSObject()
        val stored = try {
            prefs().getString(invoke.parseArgs(NameArgs::class.java).name, null)
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.javaClass.simpleName)
            return
        }
        if (stored == null) {
            invoke.resolve(result)
            return
        }
        try {
            val sealed = Base64.decode(stored, Base64.NO_WRAP)
            val key = keyStore().getKey(alias, null) as? SecretKey
            if (key == null || sealed.size <= 12) {
                // The Keystore lost its key (a restored backup): as if there were none.
                invoke.resolve(result)
                return
            }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed, 0, 12))
            val plain = cipher.doFinal(sealed, 12, sealed.size - 12)
            result.put("key", String(plain, Charsets.US_ASCII))
            invoke.resolve(result)
        } catch (e: javax.crypto.AEADBadTagException) {
            // Sealed with an earlier key: the passphrase brings the key back.
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.javaClass.simpleName)
        }
    }

    @Command
    fun forget(invoke: Invoke) {
        try {
            val prefs = prefs()
            prefs.edit().remove(invoke.parseArgs(NameArgs::class.java).name).commit()
            // The wrapping key goes with the last secret it sealed.
            if (prefs.all.isEmpty()) keyStore().deleteEntry(alias)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: e.javaClass.simpleName)
        }
    }
}
