package expo.modules.cactusnative

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

internal object AudioDecoder {
  const val TARGET_SAMPLE_RATE = 16000
  private const val PCM_24BIT_ENCODING = 21
  private const val SINC_ZERO_CROSSINGS = 8.0

  private const val MAX_POST_EOS_EMPTY_LOOPS = 300

  fun decodeToMono16k(context: Context, uriString: String): FloatArray {
    val uri = Uri.parse(uriString)
    val path = if (uri.scheme == null || uri.scheme == "file") uri.path ?: uriString else null
    val mimeHint = if (uri.scheme == "content") context.contentResolver.getType(uri) else null
    val isWav =
      (path != null && path.lowercase().endsWith(".wav")) ||
        uriString.lowercase().endsWith(".wav") ||
        mimeHint.equals("audio/wav", ignoreCase = true) ||
        mimeHint.equals("audio/x-wav", ignoreCase = true)

    if (isWav) {
      if (uri.scheme == "content") {
        val stream = context.contentResolver.openInputStream(uri)
          ?: throw IllegalArgumentException("Unable to open WAV stream")
        return stream.use { decodeWavStream(it) }
      }
      return FileInputStream(File(path ?: uriString)).use { decodeWavStream(it) }
    }

    val extractor = MediaExtractor()
    try {
      if (uri.scheme == "content") {
        extractor.setDataSource(context, uri, null)
      } else {
        extractor.setDataSource(path ?: uriString)
      }

      var audioTrackIndex = -1
      var format: MediaFormat? = null
      for (i in 0 until extractor.trackCount) {
        val trackFormat = extractor.getTrackFormat(i)
        val mime = trackFormat.getString(MediaFormat.KEY_MIME) ?: ""
        if (mime.startsWith("audio/")) {
          audioTrackIndex = i
          format = trackFormat
          break
        }
      }

      if (audioTrackIndex < 0 || format == null) {
        throw IllegalArgumentException("No audio track found in clip")
      }

      extractor.selectTrack(audioTrackIndex)
      val mime = format.getString(MediaFormat.KEY_MIME)
        ?: throw IllegalArgumentException("Audio track missing MIME type")
      var sampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
        format.getInteger(MediaFormat.KEY_SAMPLE_RATE).coerceIn(8000, 192000)
      } else {
        44100
      }
      var channelCount = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
        format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      } else {
        1
      }
      var pcmEncoding = if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
        format.getInteger(MediaFormat.KEY_PCM_ENCODING)
      } else {
        AudioFormat.ENCODING_PCM_16BIT
      }

      val codec = MediaCodec.createDecoderByType(mime)
      val rawPcm = ByteArrayOutputStream()
      var codecStarted = false
      try {
        codec.configure(format, null, null, 0)
        codec.start()
        codecStarted = true

        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        var postEosEmptyLoops = 0

        while (!outputDone) {
          if (!inputDone) {
            val inIdx = codec.dequeueInputBuffer(10_000)
            if (inIdx >= 0) {
              val inBuf = codec.getInputBuffer(inIdx)!!
              val sampleSize = extractor.readSampleData(inBuf, 0)
              if (sampleSize < 0) {
                codec.queueInputBuffer(inIdx, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inputDone = true
              } else {
                codec.queueInputBuffer(inIdx, 0, sampleSize, extractor.sampleTime, 0)
                extractor.advance()
              }
            }
          }

          val outIdx = codec.dequeueOutputBuffer(info, 10_000)
          when {
            outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
              postEosEmptyLoops = 0
              val outFormat = codec.outputFormat
              if (outFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                sampleRate = outFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE).coerceIn(8000, 192000)
              }
              if (outFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                channelCount = outFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
              }
              if (outFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                pcmEncoding = outFormat.getInteger(MediaFormat.KEY_PCM_ENCODING)
              }
            }
            outIdx >= 0 -> {
              postEosEmptyLoops = 0
              val isConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
              val outBuf = codec.getOutputBuffer(outIdx)
              if (!isConfig && outBuf != null && info.size > 0) {
                outBuf.position(info.offset)
                outBuf.limit(info.offset + info.size)
                val chunk = ByteArray(info.size)
                outBuf.get(chunk)
                rawPcm.write(chunk)
              }
              codec.releaseOutputBuffer(outIdx, false)
              if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                outputDone = true
              }
            }
            inputDone -> {
              postEosEmptyLoops += 1
              if (postEosEmptyLoops >= MAX_POST_EOS_EMPTY_LOOPS) {
                outputDone = true
              }
            }
          }
        }
      } finally {
        if (codecStarted) {
          try {
            codec.stop()
          } catch (_: Exception) {}
        }
        try {
          codec.release()
        } catch (_: Exception) {}
      }

      val mono = pcmBytesToMonoFloat(rawPcm.toByteArray(), channelCount, pcmEncoding)
      return resample(mono, sampleRate, TARGET_SAMPLE_RATE)
    } finally {
      extractor.release()
    }
  }

  private fun readExact(stream: InputStream, size: Int): ByteArray? {
    val buf = ByteArray(size)
    var read = 0
    while (read < size) {
      val n = stream.read(buf, read, size - read)
      if (n <= 0) break
      read += n
    }
    return if (read == size) buf else null
  }

  private fun skipExact(stream: InputStream, count: Long) {
    var remaining = count
    val scratch = ByteArray(4096)
    while (remaining > 0) {
      val skipped = stream.skip(remaining)
      if (skipped > 0) {
        remaining -= skipped
        continue
      }
      val n = stream.read(scratch, 0, minOf(remaining, scratch.size.toLong()).toInt())
      if (n <= 0) break
      remaining -= n
    }
  }

  private fun decodeWavStream(stream: InputStream): FloatArray {
    val header = readExact(stream, 12) ?: throw IllegalArgumentException("Invalid WAV file")
    val riff = String(header, 0, 4, Charsets.US_ASCII)
    val wave = String(header, 8, 4, Charsets.US_ASCII)
    if (riff != "RIFF" || wave != "WAVE") {
      throw IllegalArgumentException("Unsupported WAV container")
    }

    var channels = 1
    var sampleRate = TARGET_SAMPLE_RATE
    var bitsPerSample = 16
    var audioFormat = 1
    var dataBytes: ByteArray? = null

    while (true) {
      val chunkHeader = readExact(stream, 8) ?: break
      val chunkId = String(chunkHeader, 0, 4, Charsets.US_ASCII)
      val chunkSize = ByteBuffer.wrap(chunkHeader, 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
      if (chunkSize < 0) {
        throw IllegalArgumentException("Corrupt WAV chunk size")
      }
      if (chunkId == "fmt ") {
        if (chunkSize < 16) throw IllegalArgumentException("Invalid WAV fmt chunk")
        val fmtBytes = readExact(stream, chunkSize) ?: throw IllegalArgumentException("Truncated WAV fmt chunk")
        val fmtBuf = ByteBuffer.wrap(fmtBytes).order(ByteOrder.LITTLE_ENDIAN)
        audioFormat = fmtBuf.getShort(0).toInt() and 0xFFFF
        channels = (fmtBuf.getShort(2).toInt() and 0xFFFF).coerceAtLeast(1)
        sampleRate = fmtBuf.getInt(4).coerceIn(8000, 192000)
        bitsPerSample = fmtBuf.getShort(14).toInt() and 0xFFFF
        if ((chunkSize and 1) != 0) skipExact(stream, 1L)
      } else if (chunkId == "data") {
        if (chunkSize <= 0) return FloatArray(0)
        val buf = ByteArray(chunkSize)
        var read = 0
        while (read < chunkSize) {
          val n = stream.read(buf, read, chunkSize - read)
          if (n <= 0) break
          read += n
        }
        if (read <= 0) return FloatArray(0)
        dataBytes = if (read == chunkSize) buf else buf.copyOf(read)
        break
      } else {
        skipExact(stream, chunkSize.toLong() + (chunkSize and 1).toLong())
      }
    }

    val pcmBytes = dataBytes ?: return FloatArray(0)
    val encoding = when {
      audioFormat == 3 && bitsPerSample == 32 -> AudioFormat.ENCODING_PCM_FLOAT
      bitsPerSample == 24 -> PCM_24BIT_ENCODING
      bitsPerSample == 8 -> AudioFormat.ENCODING_PCM_8BIT
      else -> AudioFormat.ENCODING_PCM_16BIT
    }
    val mono = pcmBytesToMonoFloat(pcmBytes, channels, encoding)
    return resample(mono, sampleRate, TARGET_SAMPLE_RATE)
  }

  private fun pcmBytesToMonoFloat(bytes: ByteArray, channels: Int, encoding: Int): FloatArray {
    val ch = channels.coerceAtLeast(1)
    val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)

    return when (encoding) {
      AudioFormat.ENCODING_PCM_FLOAT -> {
        val frames = (bytes.size / 4) / ch
        FloatArray(frames) { frame ->
          var sum = 0f
          for (c in 0 until ch) {
            sum += buf.getFloat((frame * ch + c) * 4)
          }
          (sum / ch).coerceIn(-1f, 1f)
        }
      }
      PCM_24BIT_ENCODING -> {
        val frames = (bytes.size / 3) / ch
        FloatArray(frames) { frame ->
          var sum = 0f
          for (c in 0 until ch) {
            val base = (frame * ch + c) * 3
            val b0 = bytes[base].toInt() and 0xFF
            val b1 = bytes[base + 1].toInt() and 0xFF
            val b2 = bytes[base + 2].toInt()
            val sample24 = b0 or (b1 shl 8) or (b2 shl 16)
            sum += sample24 / 8388608f
          }
          (sum / ch).coerceIn(-1f, 1f)
        }
      }
      AudioFormat.ENCODING_PCM_8BIT -> {
        val frames = bytes.size / ch
        FloatArray(frames) { frame ->
          var sum = 0f
          for (c in 0 until ch) {
            val unsigned = bytes[frame * ch + c].toInt() and 0xFF
            sum += (unsigned - 128) / 128f
          }
          (sum / ch).coerceIn(-1f, 1f)
        }
      }
      else -> {
        val frames = (bytes.size / 2) / ch
        FloatArray(frames) { frame ->
          var sum = 0f
          for (c in 0 until ch) {
            sum += buf.getShort((frame * ch + c) * 2).toFloat() / 32768f
          }
          (sum / ch).coerceIn(-1f, 1f)
        }
      }
    }
  }

  private fun resample(input: FloatArray, srcRate: Int, dstRate: Int): FloatArray {
    if (input.isEmpty() || srcRate <= 0 || dstRate <= 0 || srcRate == dstRate) return input
    val ratio = srcRate.toDouble() / dstRate.toDouble()
    val outLength = ((input.size.toDouble() / ratio).toInt()).coerceAtLeast(1)

    if (srcRate < dstRate) {
      return FloatArray(outLength) { i ->
        val srcPos = i * ratio
        val idx = floor(srcPos).toInt().coerceIn(0, input.size - 1)
        val nextIdx = (idx + 1).coerceAtMost(input.size - 1)
        val frac = (srcPos - idx).toFloat()
        input[idx] * (1f - frac) + input[nextIdx] * frac
      }
    }

    val cutoff = dstRate.toDouble() / srcRate.toDouble()
    val windowSupport = SINC_ZERO_CROSSINGS / cutoff
    val halfWidth = ceil(windowSupport).toInt()
    val lastIdx = input.size - 1

    return FloatArray(outLength) { i ->
      val center = i * ratio
      val start = (floor(center).toInt() - halfWidth).coerceAtLeast(0)
      val end = (ceil(center).toInt() + halfWidth).coerceAtMost(lastIdx)
      var sum = 0.0
      var weightSum = 0.0

      for (j in start..end) {
        val dx = j - center
        if (abs(dx) >= windowSupport) continue
        val hann = 0.5 * (1.0 + cos(PI * dx / windowSupport))
        val arg = PI * cutoff * dx
        val sinc = if (abs(arg) < 1e-8) 1.0 else sin(arg) / arg
        val w = sinc * hann
        sum += input[j] * w
        weightSum += w
      }

      if (weightSum > 0.0) (sum / weightSum).toFloat().coerceIn(-1f, 1f) else 0f
    }
  }
}
