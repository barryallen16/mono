/* eslint-env node */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

function replaceOnce(source, target, replacement, label) {
  if (source.includes(replacement)) {
    return source;
  }
  if (!source.includes(target)) {
    throw new Error(`[with-expo-audio-fix] Expected snippet not found for: ${label}`);
  }
  return source.replace(target, replacement);
}

function patchAudioModuleKt(source) {
  let next = source;

  // 1. Add File import? Already imported in AudioModule.kt (java.io.File).
  // Fix OnDestroy calling stopRecording() on non-recording recorders.
  next = replaceOnce(
    next,
    `        for (recorder in recorders.values) {
          recorder.stopRecording()
        }`,
    `        for (recorder in recorders.values) {
          if (recorder.isRecording || recorder.isPaused) {
            try {
              recorder.stopRecording()
            } catch (_: Exception) {}
          }
        }`,
    'AudioModule.OnDestroy'
  );

  // 2. Return file:// URI from recorder.uri instead of bare cache path.
  next = replaceOnce(
    next,
    `      Property("uri") { ref ->
        ref.filePath
      }`,
    `      Property("uri") { ref ->
        ref.filePath?.let { Uri.fromFile(File(it)).toString() }
      }`,
    'AudioModule.uri'
  );

  // 3. Fix inverted !ref.isPrepared guard that prevented recording from starting on Android.
  next = replaceOnce(
    next,
    `      Function("record") { ref: AudioRecorder ->
        checkRecordingPermission()
        if (!ref.isPrepared) {
          ref.record()
        }
      }`,
    `      Function("record") { ref: AudioRecorder ->
        checkRecordingPermission()
        if (ref.isPrepared && !ref.isRecording) {
          ref.record()
        }
      }`,
    'AudioModule.record'
  );

  // 4. Fix File("file:///...") bug when loading file:// URIs into ExoPlayer.
  next = replaceOnce(
    next,
    `  private fun createMediaItem(source: AudioSource?): MediaSource? = source?.uri?.let { uri ->
    val factory = createDataSourceFactory(source)
    val uri = if (Util.isLocalFileUri(Uri.parse(source.uri))) {
      Uri.fromFile(File(source.uri))
    } else {
      Uri.parse(source.uri)
    }
    val item = MediaItem.fromUri(uri)
    buildMediaSourceFactory(factory, item)
  }

  private fun createDataSourceFactory(audioSource: AudioSource): DataSource.Factory {
    val uri = if (Util.isLocalFileUri(Uri.parse(audioSource.uri))) {
      Uri.fromFile(File(audioSource.uri))
    } else {
      Uri.parse(audioSource.uri)
    }`,
    `  private fun resolveAudioUri(raw: String): Uri {
    val parsed = Uri.parse(raw)
    return if (parsed.scheme == null) Uri.fromFile(File(raw)) else parsed
  }

  private fun createMediaItem(source: AudioSource?): MediaSource? = source?.uri?.let { raw ->
    val factory = createDataSourceFactory(source)
    val uri = resolveAudioUri(raw)
    val item = MediaItem.fromUri(uri)
    buildMediaSourceFactory(factory, item)
  }

  private fun createDataSourceFactory(audioSource: AudioSource): DataSource.Factory {
    val uri = audioSource.uri?.let { resolveAudioUri(it) } ?: Uri.EMPTY`,
    'AudioModule.resolveAudioUri'
  );

  return next;
}

function patchAudioRecorderKt(source) {
  let next = source;

  // 1. Rethrow MediaRecorder.prepare() errors instead of leaving isPrepared=false silently.
  next = replaceOnce(
    next,
    `    try {
      recorder?.prepare()
      isPrepared = true
    } catch (_: Exception) {
      recorder?.release()
      recorder = null
      isPrepared = false
    }`,
    `    try {
      recorder?.prepare()
      isPrepared = true
    } catch (e: Exception) {
      recorder?.release()
      recorder = null
      isPrepared = false
      throw e
    }`,
    'AudioRecorder.prepareRecording'
  );

  // 2. Return file:// URI in getAudioRecorderStatus().url so expo-file-system can copy it.
  next = replaceOnce(
    next,
    `      putString("url", filePath)`,
    `      putString("url", filePath?.let { Uri.fromFile(File(it)).toString() })`,
    'AudioRecorder.getAudioRecorderStatus'
  );

  // 3. Use VOICE_RECOGNITION audio source for speech clarity on Android.
  next = replaceOnce(
    next,
    `setAudioSource(MediaRecorder.AudioSource.MIC)`,
    `setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)`,
    'AudioRecorder.audioSource'
  );

  // 4. Fix metering dB scale (20 * log10 instead of 20 * ln).
  next = replaceOnce(
    next,
    `(20 * ln(amplitude.toDouble() / 32767.0)).toInt()`,
    `(20 * kotlin.math.log10(amplitude.toDouble() / 32767.0)).toInt()`,
    'AudioRecorder.meteringLog10'
  );

  return next;
}

function applyExpoAudioPatches(projectRoot) {
  const audioJavaDir = path.join(
    projectRoot,
    'node_modules',
    'expo-audio',
    'android',
    'src',
    'main',
    'java',
    'expo',
    'modules',
    'audio'
  );

  const modulePath = path.join(audioJavaDir, 'AudioModule.kt');
  if (fs.existsSync(modulePath)) {
    const original = fs.readFileSync(modulePath, 'utf8');
    const patched = patchAudioModuleKt(original);
    if (patched !== original) {
      fs.writeFileSync(modulePath, patched, 'utf8');
    }
  }

  const recorderPath = path.join(audioJavaDir, 'AudioRecorder.kt');
  if (fs.existsSync(recorderPath)) {
    const original = fs.readFileSync(recorderPath, 'utf8');
    const patched = patchAudioRecorderKt(original);
    if (patched !== original) {
      fs.writeFileSync(recorderPath, patched, 'utf8');
    }
  }
}

module.exports = function withExpoAudioFix(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      applyExpoAudioPatches(modConfig.modRequest.projectRoot);
      return modConfig;
    },
  ]);
};

module.exports.applyExpoAudioPatches = applyExpoAudioPatches;
