package expo.modules.cactusnative

import android.content.Context
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

private data class CactusModelSpec(
  val id: String,
  val filename: String,
  val url: String,
  val sha256: String,
  val maskBit: Int
)

private val MODEL_SPECS = listOf(
  CactusModelSpec(
    id = "whistle",
    filename = "whistle.cact",
    url = "https://huggingface.co/Cactus-Compute/whistle/resolve/88cb00eeb8928ddbcd410b491584f938ba030b07/whistle.cact",
    sha256 = "b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb",
    maskBit = 2
  ),
  CactusModelSpec(
    id = "needle3",
    filename = "needle3.cact",
    url = "https://huggingface.co/Cactus-Compute/needle3/resolve/d6c7d6a2e9655505e0f8e23339356dd1705900eb/needle3.cact",
    sha256 = "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38",
    maskBit = 1
  )
)

private const val MAX_WHISTLE_CHUNK_SAMPLES = 30 * 16000

private val NOTE_TOOLS_JSON = JSONArray().put(
  JSONObject()
    .put("name", "save_note")
    .put(
      "description",
      "Extract a short title, concise summary, relevant tags, and concrete action items from a voice log or text note."
    )
    .put(
      "parameters",
      JSONObject()
        .put("type", "object")
        .put(
          "properties",
          JSONObject()
            .put(
              "title",
              JSONObject()
                .put("type", "string")
                .put("description", "Short 3 to 7 word headline summarizing the note")
            )
            .put(
              "summary",
              JSONObject()
                .put("type", "string")
                .put("description", "One or two sentence summary of the note")
            )
            .put(
              "tags",
              JSONObject()
                .put("type", "array")
                .put(
                  "items",
                  JSONObject()
                    .put("type", "string")
                    .put(
                      "enum",
                      JSONArray(listOf("bug", "ship", "idea", "people", "todo", "study", "log"))
                    )
                )
                .put("description", "Relevant tags for the note")
            )
            .put(
              "action_items",
              JSONObject()
                .put("type", "array")
                .put("items", JSONObject().put("type", "string"))
                .put("description", "Actionable todo tasks mentioned in the note")
            )
        )
        .put("required", JSONArray(listOf("title", "tags", "action_items")))
    )
).toString()

class CactusNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  private val modelMutex = Mutex()
  private var initializedDate: String? = null

  private fun cacheDir(): File = File(context.filesDir, "cactus").apply { mkdirs() }

  private fun modelFile(spec: CactusModelSpec): File = File(cacheDir(), spec.filename)

  private fun sha256Hex(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(65536)
    FileInputStream(file).use { input ->
      while (true) {
        val read = input.read(buf)
        if (read <= 0) break
        digest.update(buf, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun isCachedValid(spec: CactusModelSpec): Boolean {
    val file = modelFile(spec)
    return file.exists() && file.length() > 0 && sha256Hex(file) == spec.sha256
  }

  private fun buildStatusMap(): Map<String, Any?> {
    val supported = CactusBridge.nativeIsSupported()
    val mask = if (supported) CactusBridge.nativeLoadedModelsMask() else 0
    val whistleFile = modelFile(MODEL_SPECS[0])
    val needleFile = modelFile(MODEL_SPECS[1])
    return mapOf(
      "supported" to supported,
      "abi" to (Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"),
      "modelsLoadedMask" to mask,
      "whistleLoaded" to ((mask and 2) != 0),
      "needleLoaded" to ((mask and 1) != 0),
      "whistleCached" to (whistleFile.exists() && whistleFile.length() > 0),
      "needleCached" to (needleFile.exists() && needleFile.length() > 0),
      "whistleBytes" to (if (whistleFile.exists()) whistleFile.length() else 0L),
      "needleBytes" to (if (needleFile.exists()) needleFile.length() else 0L)
    )
  }

  private fun downloadModelIfNeeded(spec: CactusModelSpec): File {
    val target = modelFile(spec)
    if (isCachedValid(spec)) {
      sendEvent(
        "onModelProgress",
        mapOf(
          "model" to spec.id,
          "phase" to "cached",
          "progress" to 1.0,
          "receivedBytes" to target.length(),
          "totalBytes" to target.length()
        )
      )
      return target
    }

    if (target.exists()) target.delete()
    val tmp = File(cacheDir(), "${spec.filename}.part")
    if (tmp.exists()) tmp.delete()

    val conn = (URL(spec.url).openConnection() as HttpURLConnection).apply {
      instanceFollowRedirects = true
      connectTimeout = 20_000
      readTimeout = 60_000
    }

    try {
      conn.connect()
      if (conn.responseCode !in 200..299) {
        throw RuntimeException("Failed downloading ${spec.id}: HTTP ${conn.responseCode}")
      }
      val total = conn.contentLengthLong.takeIf { it > 0 } ?: -1L
      var received = 0L
      var lastEmitMs = 0L
      val digest = MessageDigest.getInstance("SHA-256")
      val buf = ByteArray(65536)

      conn.inputStream.use { input ->
        FileOutputStream(tmp).use { output ->
          while (true) {
            val read = input.read(buf)
            if (read <= 0) break
            output.write(buf, 0, read)
            digest.update(buf, 0, read)
            received += read
            val now = System.currentTimeMillis()
            if (now - lastEmitMs >= 150) {
              lastEmitMs = now
              val pct = if (total > 0) (received.toDouble() / total.toDouble()).coerceIn(0.0, 1.0) else 0.0
              sendEvent(
                "onModelProgress",
                mapOf(
                  "model" to spec.id,
                  "phase" to "downloading",
                  "progress" to pct,
                  "receivedBytes" to received,
                  "totalBytes" to total
                )
              )
            }
          }
        }
      }

      val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
      if (actualHash != spec.sha256) {
        tmp.delete()
        throw RuntimeException("Checksum mismatch for ${spec.id}: expected ${spec.sha256}, got $actualHash")
      }
      if (!tmp.renameTo(target)) {
        tmp.copyTo(target, overwrite = true)
        tmp.delete()
      }
      sendEvent(
        "onModelProgress",
        mapOf(
          "model" to spec.id,
          "phase" to "ready",
          "progress" to 1.0,
          "receivedBytes" to received,
          "totalBytes" to received
        )
      )
      return target
    } catch (err: Exception) {
      tmp.delete()
      throw err
    } finally {
      conn.disconnect()
    }
  }

  private fun ensureLoadedLocked(specIds: Set<String>) {
    if (!CactusBridge.nativeIsSupported()) {
      throw RuntimeException("Cactus native engine supports arm64-v8a / armeabi-v7a only")
    }
    val currentMask = CactusBridge.nativeLoadedModelsMask()
    for (spec in MODEL_SPECS) {
      if (spec.id !in specIds) continue
      if ((currentMask and spec.maskBit) != 0) continue
      val file = downloadModelIfNeeded(spec)
      CactusBridge.loadModel(file.absolutePath)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("CactusNative")

    Events("onModelProgress")

    AsyncFunction("getStatus") Coroutine { ->
      withContext(Dispatchers.IO) { buildStatusMap() }
    }

    AsyncFunction("prepareModels") Coroutine { ->
      modelMutex.withLock {
        withContext(Dispatchers.IO) {
          ensureLoadedLocked(setOf("whistle", "needle3"))
          buildStatusMap()
        }
      }
    }

    AsyncFunction("clearModels") Coroutine { ->
      modelMutex.withLock {
        withContext(Dispatchers.IO) {
          cacheDir().listFiles()?.forEach { it.delete() }
          initializedDate = null
          buildStatusMap()
        }
      }
    }

    AsyncFunction("transcribeFile") Coroutine { uri: String, language: String? ->
      modelMutex.withLock {
        withContext(Dispatchers.IO) {
          ensureLoadedLocked(setOf("whistle"))
          val samples = AudioDecoder.decodeToMono16k(context, uri)
          if (samples.isEmpty()) {
            return@withContext mapOf("text" to "", "language" to (language ?: ""), "chunks" to 0)
          }

          val parts = mutableListOf<String>()
          var detectedLanguage = language ?: ""
          var offset = 0
          var chunkCount = 0

          while (offset < samples.size) {
            val end = (offset + MAX_WHISTLE_CHUNK_SAMPLES).coerceAtMost(samples.size)
            val slice = if (offset == 0 && end == samples.size) {
              samples
            } else {
              samples.copyOfRange(offset, end)
            }
            val rawJson = CactusBridge.transcribe(slice, language, null, false)
            val parsed = JSONObject(rawJson)
            val chunkText = parsed.optString("text", "").trim()
            if (chunkText.isNotEmpty()) {
              parts.add(chunkText)
            }
            if (detectedLanguage.isEmpty()) {
              detectedLanguage = parsed.optString("language", "")
            }
            chunkCount += 1
            offset = end
          }

          mapOf(
            "text" to parts.joinToString(" "),
            "language" to detectedLanguage,
            "chunks" to chunkCount
          )
        }
      }
    }

    AsyncFunction("extractNote") Coroutine { text: String, localDate: String ->
      modelMutex.withLock {
        withContext(Dispatchers.IO) {
          ensureLoadedLocked(setOf("needle3"))
          if (initializedDate != localDate) {
            val systemPrompt = "date: $localDate\nExtract a structured voice note using save_note."
            CactusBridge.initText(systemPrompt, NOTE_TOOLS_JSON)
            initializedDate = localDate
          }
          val rawJson = CactusBridge.complete(text, 384)
          val root = JSONObject(rawJson)
          val calls = root.optJSONArray("function_calls")
          val firstCall = if (calls != null && calls.length() > 0) calls.getJSONObject(0) else null

          val args = firstCall?.optJSONObject("arguments") ?: JSONObject()
          val tagsArr = args.optJSONArray("tags") ?: JSONArray()
          val itemsArr = args.optJSONArray("action_items") ?: JSONArray()

          val tags = mutableListOf<String>()
          for (i in 0 until tagsArr.length()) {
            val t = tagsArr.optString(i, "").trim()
            if (t.isNotEmpty() && t !in tags) tags.add(t)
          }

          val actionItems = mutableListOf<String>()
          for (i in 0 until itemsArr.length()) {
            val item = itemsArr.optString(i, "").trim()
            if (item.isNotEmpty()) actionItems.add(item)
          }

          val rawConfidence = if (root.isNull("confidence")) null else root.optDouble("confidence", Double.NaN)
          val confidence = rawConfidence?.takeIf { !it.isNaN() && !it.isInfinite() }

          mapOf(
            "matched" to (firstCall != null),
            "title" to args.optString("title", "").trim(),
            "summary" to args.optString("summary", "").trim(),
            "tags" to tags,
            "actionItems" to actionItems,
            "confidence" to confidence
          )
        }
      }
    }

    AsyncFunction("embedText") Coroutine { text: String ->
      modelMutex.withLock {
        withContext(Dispatchers.IO) {
          ensureLoadedLocked(setOf("needle3"))
          CactusBridge.embed(text).toList()
        }
      }
    }
  }
}
