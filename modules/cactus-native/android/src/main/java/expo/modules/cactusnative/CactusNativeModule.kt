package expo.modules.cactusnative

import android.content.Context
import android.os.Build
import android.util.Log
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
import java.text.SimpleDateFormat
import java.util.Locale

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
    url = "https://huggingface.co/barryallen16/whistle-svarah/resolve/d605dca6f1c5e40e227c8c4289c96dc8bf1539d3/tuned.cact",
    sha256 = "a5d30d55c65ee98325d0ea473e241a0bba073f9bdde43a2d35411ad0b2349bd3",
    maskBit = 2
  ),
  CactusModelSpec(
    id = "needle3",
    filename = "needle3.cact",
    url = "https://huggingface.co/barryallen16/needle3-notes/resolve/ffb226b2f8feacf7ddb49f46795c89ae26d2dc6c/tuned.cact",
    sha256 = "697fead70617b80f5bc74765aafb5062ee25e6ef910fab5ed5f613329218c55a",
    maskBit = 1
  )
)

private const val MAX_WHISTLE_CHUNK_SAMPLES = 30 * 16000
private const val OVERLAP_SAMPLES = (1.5 * 16000).toInt()
private const val MAX_OVERLAP_WORDS = 6
private val BOOLEAN_TAG_FLAGS = listOf(
  "is_bug" to "bug",
  "is_ship" to "ship",
  "is_idea" to "idea",
  "is_people" to "people",
  "is_study" to "study"
)

private val NOTE_TOOLS_JSON = JSONArray().put(
  JSONObject()
    .put("name", "save_note")
    .put("description", "Save a voice or text note with headline, category flags, and pending todo tasks.")
    .put("triggers", JSONArray(listOf("\\S")))
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
                .put("description", "Short headline copied from the note")
            )
            .put(
              "is_bug",
              JSONObject()
                .put("type", "boolean")
                .put("description", "True only for software bug, crash, or error")
            )
            .put(
              "is_ship",
              JSONObject()
                .put("type", "boolean")
                .put("description", "True for release, build, deploy, or PR")
            )
            .put(
              "is_idea",
              JSONObject()
                .put("type", "boolean")
                .put("description", "True for feature idea, brainstorm, or open question")
            )
            .put(
              "is_people",
              JSONObject()
                .put("type", "boolean")
                .put("description", "True when a person, friend, family, or contact is mentioned")
            )
            .put(
              "is_study",
              JSONObject()
                .put("type", "boolean")
                .put("description", "True for reading, learning, papers, books, or courses")
            )
            .put(
              "action_items",
              JSONObject()
                .put("type", "array")
                .put("items", JSONObject().put("type", "string"))
                .put(
                  "description",
                  "Pending future todo tasks copied from the note. Omit past events and observations."
                )
            )
        )
        .put("required", JSONArray(listOf("title")))
    )
).toString()

private fun normalizeBoundaryWord(word: String): String =
  word.trim { !it.isLetterOrDigit() }.lowercase()

private fun mergeChunkTranscripts(parts: List<String>): String {
  if (parts.isEmpty()) return ""
  val merged = mutableListOf<String>()
  val whitespace = Regex("\\s+")
  val trailingPunct = Regex("[.!?,;:]$")
  for (part in parts) {
    val words = part.trim().split(whitespace).filter { it.isNotEmpty() }
    if (words.isEmpty()) continue
    if (merged.isEmpty()) {
      merged.addAll(words)
      continue
    }
    val maxOverlap = minOf(MAX_OVERLAP_WORDS, merged.size, words.size)
    var overlap = 0
    for (k in maxOverlap downTo 1) {
      var matches = true
      for (i in 0 until k) {
        val left = normalizeBoundaryWord(merged[merged.size - k + i])
        val right = normalizeBoundaryWord(words[i])
        if (left.isEmpty() || left != right) {
          matches = false
          break
        }
      }
      if (matches) {
        overlap = k
        break
      }
    }
    if (
      overlap > 0 &&
      trailingPunct.containsMatchIn(words[overlap - 1]) &&
      !trailingPunct.containsMatchIn(merged.last())
    ) {
      merged[merged.lastIndex] = words[overlap - 1]
    }
    merged.addAll(words.drop(overlap))
  }
  return merged.joinToString(" ")
}

private fun formatDateFact(localDate: String): String {
  return try {
    val parser = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { isLenient = false }
    val parsed = parser.parse(localDate) ?: return localDate
    SimpleDateFormat("yyyy-MM-dd EEE", Locale.US).format(parsed)
  } catch (_: Exception) {
    localDate
  }
}

class CactusNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  private val downloadMutexes = MODEL_SPECS.associate { it.id to Mutex() }
  private val inferenceMutex = Mutex()
  private var initializedDate: String? = null
  private var threadsConfigured = false

  private fun cacheDir(): File = File(context.filesDir, "cactus").apply { mkdirs() }

  private fun modelFile(spec: CactusModelSpec): File = File(cacheDir(), spec.filename)

  private fun partFile(spec: CactusModelSpec): File = File(cacheDir(), "${spec.filename}.part")

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

  private fun isCachedComplete(spec: CactusModelSpec): Boolean {
    val file = modelFile(spec)
    return file.exists() && file.length() > 0 && !partFile(spec).exists()
  }

  private fun isCachedValid(spec: CactusModelSpec): Boolean {
    val file = modelFile(spec)
    return isCachedComplete(spec) && sha256Hex(file) == spec.sha256
  }

  private fun buildStatusMap(): Map<String, Any?> {
    val supported = CactusBridge.nativeIsSupported()
    val mask = if (supported) CactusBridge.nativeLoadedModelsMask() else 0
    val whistleSpec = MODEL_SPECS[0]
    val needleSpec = MODEL_SPECS[1]
    val whistleFile = modelFile(whistleSpec)
    val needleFile = modelFile(needleSpec)
    val whistleCached = isCachedComplete(whistleSpec)
    val needleCached = isCachedComplete(needleSpec)
    return mapOf(
      "supported" to supported,
      "abi" to (Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"),
      "modelsLoadedMask" to mask,
      "whistleLoaded" to ((mask and whistleSpec.maskBit) != 0),
      "needleLoaded" to ((mask and needleSpec.maskBit) != 0),
      "whistleCached" to whistleCached,
      "needleCached" to needleCached,
      "whistleBytes" to (if (whistleCached) whistleFile.length() else 0L),
      "needleBytes" to (if (needleCached) needleFile.length() else 0L)
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
    val tmp = partFile(spec)
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
              val pct = if (total > 0) (received.toDouble() / total.toDouble()).coerceIn(0.0, 1.0) else -1.0
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

  private suspend fun ensureLoadedLocked(specIds: Set<String>) {
    if (!CactusBridge.nativeIsSupported()) {
      throw RuntimeException("Cactus native engine supports arm64-v8a / armeabi-v7a only")
    }
    for (spec in MODEL_SPECS) {
      if (spec.id !in specIds) continue
      val loadedAlready = (CactusBridge.nativeLoadedModelsMask() and spec.maskBit) != 0
      if (loadedAlready && isCachedComplete(spec)) continue
      downloadMutexes.getValue(spec.id).withLock {
        val stillLoaded = (CactusBridge.nativeLoadedModelsMask() and spec.maskBit) != 0
        if (stillLoaded && isCachedComplete(spec)) return@withLock
        val file = withContext(Dispatchers.IO) { downloadModelIfNeeded(spec) }
        inferenceMutex.withLock {
          if ((CactusBridge.nativeLoadedModelsMask() and spec.maskBit) != 0) return@withLock
          val fileSize = file.length()
          sendEvent(
            "onModelProgress",
            mapOf(
              "model" to spec.id,
              "phase" to "loading",
              "progress" to 1.0,
              "receivedBytes" to fileSize,
              "totalBytes" to fileSize
            )
          )
          withContext(Dispatchers.IO) {
            if (!threadsConfigured) {
              val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
              CactusBridge.nativeSetThreads(threads)
              threadsConfigured = true
            }
            CactusBridge.loadModel(file.absolutePath)
          }
          sendEvent(
            "onModelProgress",
            mapOf(
              "model" to spec.id,
              "phase" to "ready",
              "progress" to 1.0,
              "receivedBytes" to fileSize,
              "totalBytes" to fileSize
            )
          )
        }
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("CactusNative")

    Events("onModelProgress")

    AsyncFunction("getStatus") Coroutine { ->
      withContext(Dispatchers.IO) { buildStatusMap() }
    }

    AsyncFunction("prepareModels") Coroutine { ->
      ensureLoadedLocked(setOf("whistle", "needle3"))
      withContext(Dispatchers.IO) { buildStatusMap() }
    }

    AsyncFunction("clearModels") Coroutine { ->
      downloadMutexes.getValue("whistle").withLock {
        downloadMutexes.getValue("needle3").withLock {
          inferenceMutex.withLock {
            withContext(Dispatchers.IO) {
              cacheDir().listFiles()?.forEach { it.delete() }
              for (spec in MODEL_SPECS) {
                modelFile(spec).delete()
                partFile(spec).delete()
              }
              initializedDate = null
              buildStatusMap()
            }
          }
        }
      }
    }

    AsyncFunction("transcribeFile") Coroutine { uri: String, language: String?, keywords: String? ->
      ensureLoadedLocked(setOf("whistle"))
      val samples = withContext(Dispatchers.IO) { AudioDecoder.decodeToMono16k(context, uri) }
      if (samples.isEmpty()) {
        return@Coroutine mapOf("text" to "", "language" to (language ?: ""), "chunks" to 0)
      }
      val normalizedKeywords = keywords
        ?.split(Regex("\\r?\\n"))
        ?.map { it.trim() }
        ?.filter { it.isNotEmpty() }
        ?.joinToString("\n")
        ?.takeIf { it.isNotEmpty() }

      inferenceMutex.withLock {
        withContext(Dispatchers.IO) {
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
            val rawJson = CactusBridge.transcribe(slice, language, normalizedKeywords, false)
            val parsed = try {
              JSONObject(rawJson)
            } catch (err: Exception) {
              throw RuntimeException("Invalid Whistle output", err)
            }
            val chunkText = parsed.optString("text", "").trim()
            if (chunkText.isNotEmpty()) {
              parts.add(chunkText)
            }
            if (detectedLanguage.isEmpty()) {
              detectedLanguage = parsed.optString("language", "")
            }
            chunkCount += 1
            offset = if (end >= samples.size) {
              end
            } else {
              (end - OVERLAP_SAMPLES).coerceAtLeast(offset + 1)
            }
          }

          mapOf(
            "text" to mergeChunkTranscripts(parts),
            "language" to detectedLanguage,
            "chunks" to chunkCount
          )
        }
      }
    }

    AsyncFunction("extractNote") Coroutine { text: String, localDate: String ->
      ensureLoadedLocked(setOf("needle3"))
      inferenceMutex.withLock {
        withContext(Dispatchers.IO) {
          if (initializedDate != localDate) {
            val systemPrompt =
              "date: ${formatDateFact(localDate)}; Always save notes with save_note. Copy headline and pending future tasks verbatim. Omit completed past events, questions, and observations from action_items."
            CactusBridge.initText(systemPrompt, NOTE_TOOLS_JSON)
            initializedDate = localDate
          }
          val cleanInput = text.trim().trim('"', '\'').ifEmpty { text.trim() }.take(12_000)
          val rawJson = CactusBridge.complete(cleanInput, 640)
          val preview = rawJson.trim().replace(Regex("\\s+"), " ").take(160)
          val root = try {
            JSONObject(rawJson)
          } catch (_: Exception) {
            val rawErr = "Needle 3 invalid JSON: ${preview.ifEmpty { "<empty>" }}"
            Log.w("CactusNative", rawErr)
            return@withContext mapOf(
              "matched" to false,
              "title" to "",
              "summary" to "",
              "tags" to emptyList<String>(),
              "actionItems" to emptyList<String>(),
              "confidence" to null,
              "rawError" to rawErr
            )
          }
          val calls = root.optJSONArray("function_calls")
          val suppressed = root.optJSONArray("suppressed_calls")
          val firstCall = calls?.optJSONObject(0) ?: suppressed?.optJSONObject(0)
          val callName = firstCall?.optString("name", "") ?: ""
          val validCall = firstCall != null && (callName.isEmpty() || callName == "save_note")

          val args = if (!validCall) {
            JSONObject()
          } else {
            when (val rawArgs = firstCall?.opt("arguments")) {
              is JSONObject -> rawArgs
              is String -> try {
                JSONObject(rawArgs)
              } catch (_: Exception) {
                JSONObject()
              }
              else -> JSONObject()
            }
          }
          val itemsArr = args.optJSONArray("action_items") ?: JSONArray()

          val actionItems = mutableListOf<String>()
          for (i in 0 until itemsArr.length()) {
            val item = itemsArr.optString(i, "").trim()
            if (item.isNotEmpty()) actionItems.add(item)
          }

          val tags = mutableListOf<String>()
          for ((flag, tag) in BOOLEAN_TAG_FLAGS) {
            if (args.optBoolean(flag, false)) tags.add(tag)
          }
          if (actionItems.isNotEmpty()) {
            tags.add("todo")
          }
          if (tags.isEmpty()) {
            tags.add("log")
          }

          val rawConfidence = if (root.isNull("confidence")) null else root.optDouble("confidence", Double.NaN)
          val confidence = rawConfidence?.takeIf { !it.isNaN() && !it.isInfinite() }

          val rawErr = if (validCall) null else "Needle 3 missed save_note: ${preview.ifEmpty { "<empty>" }}"
          if (rawErr != null) {
            Log.w("CactusNative", rawErr)
          }
          mapOf(
            "matched" to validCall,
            "title" to args.optString("title", "").trim(),
            "summary" to args.optString("summary", "").trim(),
            "tags" to tags,
            "actionItems" to actionItems,
            "confidence" to confidence,
            "rawError" to rawErr
          )
        }
      }
    }
  }
}
