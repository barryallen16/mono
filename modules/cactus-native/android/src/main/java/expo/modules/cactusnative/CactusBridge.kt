package expo.modules.cactusnative

object CactusBridge {
  init {
    System.loadLibrary("cactusnative")
  }

  @JvmStatic external fun nativeIsSupported(): Boolean
  @JvmStatic external fun nativeLoadedModelsMask(): Int
  @JvmStatic private external fun nativeLoadModel(pathUtf8: ByteArray): Int
  @JvmStatic private external fun nativeInitText(systemPromptUtf8: ByteArray, toolsJsonUtf8: ByteArray): Int
  @JvmStatic private external fun nativeComplete(inputUtf8: ByteArray, maxNewTokens: Int): ByteArray
  @JvmStatic private external fun nativeTranscribe(
    pcm: FloatArray,
    languageUtf8: ByteArray?,
    keywordsUtf8: ByteArray?,
    wordTimestamps: Boolean
  ): ByteArray

  fun loadModel(path: String): Int = nativeLoadModel(path.toByteArray(Charsets.UTF_8))

  fun initText(systemPrompt: String, toolsJson: String): Int =
    nativeInitText(systemPrompt.toByteArray(Charsets.UTF_8), toolsJson.toByteArray(Charsets.UTF_8))

  fun complete(input: String, maxNewTokens: Int): String =
    String(nativeComplete(input.toByteArray(Charsets.UTF_8), maxNewTokens), Charsets.UTF_8)

  fun transcribe(
    pcm: FloatArray,
    language: String?,
    keywords: String?,
    wordTimestamps: Boolean
  ): String =
    String(
      nativeTranscribe(
        pcm,
        language?.toByteArray(Charsets.UTF_8),
        keywords?.toByteArray(Charsets.UTF_8),
        wordTimestamps
      ),
      Charsets.UTF_8
    )
}
