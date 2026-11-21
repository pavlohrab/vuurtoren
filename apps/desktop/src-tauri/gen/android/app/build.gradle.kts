import java.net.URI
import java.security.MessageDigest
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// The dictionary the APK carries (BundledPacks.kt, docs/android.md): the `dictionary-nl`
// archive that the language server's packs.json names, from server/nlp/dist/packs when it was
// built on this computer, else downloaded from the public packs release (not with
// VUURTOREN_PACKS_OFFLINE=1). Checked by size and SHA-256. Without it the build goes on and the
// app downloads the dictionary at first start instead.
val packsAssets: File = layout.buildDirectory.dir("generated/vuurtoren-packs").get().asFile
val repoRoot: File = rootProject.file("../../../../..")
val vuurtorenPacks = tasks.register("vuurtorenPacks") {
    val manifest = File(repoRoot, "server/nlp/src/vuurtoren_nlp/packs.json")
    val out = File(packsAssets, "packs/dictionary-nl.tar.gz")
    val dist = File(repoRoot, "server/nlp/dist/packs")
    inputs.file(manifest)
    doLast {
        fun sha256(f: File): String {
            val md = MessageDigest.getInstance("SHA-256")
            f.inputStream().use { s ->
                val buf = ByteArray(1 shl 16)
                while (true) {
                    val n = s.read(buf)
                    if (n < 0) break
                    md.update(buf, 0, n)
                }
            }
            return md.digest().joinToString("") { "%02x".format(it) }
        }
        val packs = (groovy.json.JsonSlurper().parse(manifest) as Map<*, *>)["packs"] as Map<*, *>
        val pack = packs["dictionary-nl"] as Map<*, *>
        val version = pack["version"] as String
        val sum = pack["sha256"] as String
        val size = (pack["size"] as Number).toLong()
        fun good(f: File) = f.isFile && f.length() == size && sha256(f) == sum
        val local = File(dist, "dictionary-nl-$version.tar.gz")
        out.parentFile.mkdirs()
        when {
            good(out) -> logger.lifecycle("Dictionary $version: in the APK")
            good(local) -> {
                local.copyTo(out, overwrite = true)
                logger.lifecycle("Dictionary $version: copied from ${local.path}")
            }
            System.getenv("VUURTOREN_PACKS_OFFLINE") == "1" -> {
                out.delete()
                logger.warn("Dictionary $version: not at hand; the app downloads it instead")
            }
            else -> {
                val url = "https://github.com/pavlohrab/Vuurtoren/releases/download/" +
                    "packs-$version/dictionary-nl-$version.tar.gz"
                val part = File(out.path + ".part")
                try {
                    URI(url).toURL().openStream().use { input ->
                        part.outputStream().use { input.copyTo(it, 1 shl 16) }
                    }
                    if (!good(part)) throw GradleException("checksum or size does not match")
                    part.renameTo(out)
                    logger.lifecycle("Dictionary $version: downloaded")
                } catch (e: Exception) {
                    part.delete()
                    out.delete()
                    logger.warn("Dictionary $version: download failed ($e); the app downloads it instead")
                }
            }
        }
    }
}
tasks.named("preBuild") { dependsOn(vuurtorenPacks) }

android {
    compileSdk = 36
    namespace = "app.vuurtoren"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "app.vuurtoren"
        minSdk = 26
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
    // The dictionary archive is gzip already: stored as it is, read without inflating twice.
    androidResources {
        noCompress.add("gz")
    }
    sourceSets["main"].assets.srcDir(packsAssets)
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
