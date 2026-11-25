package expo.modules.cactusnative

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.floor

internal object AudioDecoder {
  const val TARGET_SAMPLE_RATE = 16000
  private const val PCM_24BIT_ENCODING = 21

  fun decodeToMono16k(context: Context, uriString: String): FloatArray {
    val uri = Uri.parse(uriString)
    val path = if (uri.scheme == null || uri.scheme == "file") uri.path ?: uriString else null

    if (path != null && path.lowercase().endsWith(".wav")) {
      return decodeWavFile(File(path))
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
        format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
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
              val outFormat = codec.outputFormat
              if (outFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                sampleRate = outFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
              }
              if (outFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                channelCount = outFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
              }
              if (outFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                pcmEncoding = outFormat.getInteger(MediaFormat.KEY_PCM_ENCODING)
              }
            }
            outIdx >= 0 -> {
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
      return resampleLinear(mono, sampleRate, TARGET_SAMPLE_RATE)
    } finally {
      extractor.release()
    }
  }

  private fun decodeWavFile(file: File): FloatArray {
    val bytes = file.readBytes()
    if (bytes.size < 44) throw IllegalArgumentException("Invalid WAV file")
    val riff = String(bytes, 0, 4, Charsets.US_ASCII)
    val wave = String(bytes, 8, 4, Charsets.US_ASCII)
    if (riff != "RIFF" || wave != "WAVE") {
      throw IllegalArgumentException("Unsupported WAV container")
    }

    val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    var channels = 1
    var sampleRate = TARGET_SAMPLE_RATE
    var bitsPerSample = 16
    var audioFormat = 1
    var dataStart = -1
    var dataSize = 0

    var pos = 12
    while (pos + 8 <= bytes.size) {
      val chunkId = String(bytes, pos, 4, Charsets.US_ASCII)
      val chunkSize = buf.getInt(pos + 4)
      if (chunkSize < 0) {
        throw IllegalArgumentException("Corrupt WAV chunk size")
      }
      val payloadStart = pos + 8
      if (chunkId == "fmt " && payloadStart + 16 <= bytes.size) {
        audioFormat = buf.getShort(payloadStart).toInt() and 0xFFFF
        channels = (buf.getShort(payloadStart + 2).toInt() and 0xFFFF).coerceAtLeast(1)
        sampleRate = buf.getInt(payloadStart + 4).coerceAtLeast(8000)
        bitsPerSample = buf.getShort(payloadStart + 14).toInt() and 0xFFFF
      } else if (chunkId == "data") {
        dataStart = payloadStart
        dataSize = chunkSize.coerceAtMost((bytes.size - dataStart).coerceAtLeast(0))
        break
      }
      val step = 8L + chunkSize.toLong() + (chunkSize and 1).toLong()
      if (step <= 0L || pos + step > Int.MAX_VALUE) break
      pos += step.toInt()
    }

    if (dataStart < 0 || dataSize <= 0) {
      return FloatArray(0)
    }

    val encoding = when {
      audioFormat == 3 && bitsPerSample == 32 -> AudioFormat.ENCODING_PCM_FLOAT
      bitsPerSample == 24 -> PCM_24BIT_ENCODING
      bitsPerSample == 8 -> AudioFormat.ENCODING_PCM_8BIT
      else -> AudioFormat.ENCODING_PCM_16BIT
    }
    val slice = bytes.copyOfRange(dataStart, dataStart + dataSize)
    val mono = pcmBytesToMonoFloat(slice, channels, encoding)
    return resampleLinear(mono, sampleRate, TARGET_SAMPLE_RATE)
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

  private fun resampleLinear(input: FloatArray, srcRate: Int, dstRate: Int): FloatArray {
    if (input.isEmpty() || srcRate <= 0 || srcRate == dstRate) return input
    val ratio = srcRate.toDouble() / dstRate.toDouble()
    val outLength = ((input.size.toDouble() / ratio).toInt()).coerceAtLeast(1)
    return FloatArray(outLength) { i ->
      val srcPos = i * ratio
      val idx = floor(srcPos).toInt().coerceIn(0, input.size - 1)
      val nextIdx = (idx + 1).coerceAtMost(input.size - 1)
      val frac = (srcPos - idx).toFloat()
      input[idx] * (1f - frac) + input[nextIdx] * frac
    }
  }
}
