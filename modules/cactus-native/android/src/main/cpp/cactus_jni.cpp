#include <jni.h>
#include <algorithm>
#include <cstdint>
#include <fstream>
#include <mutex>
#include <string>
#include <vector>

#if CACTUS_NATIVE_ENABLED
#include "cactus.h"
#endif

namespace {

std::mutex g_cactus_mutex;

void throwRuntime(JNIEnv* env, const char* message) {
  jclass exClass = env->FindClass("java/lang/RuntimeException");
  if (exClass != nullptr) {
    env->ThrowNew(exClass, message ? message : "Cactus native error");
  }
}

std::string bytesToStdString(JNIEnv* env, jbyteArray arr) {
  if (arr == nullptr) return "";
  const jsize len = env->GetArrayLength(arr);
  if (len <= 0) return "";
  std::string out(static_cast<size_t>(len), '\0');
  env->GetByteArrayRegion(arr, 0, len, reinterpret_cast<jbyte*>(&out[0]));
  return out;
}

jbyteArray stdStringToBytes(JNIEnv* env, const char* str) {
  if (str == nullptr) {
    return env->NewByteArray(0);
  }
  const jsize len = static_cast<jsize>(std::char_traits<char>::length(str));
  jbyteArray out = env->NewByteArray(len);
  if (out != nullptr && len > 0) {
    env->SetByteArrayRegion(out, 0, len, reinterpret_cast<const jbyte*>(str));
  }
  return out;
}

}

extern "C" {

JNIEXPORT jboolean JNICALL
Java_expo_modules_cactusnative_CactusBridge_nativeIsSupported(JNIEnv*, jclass) {
#if CACTUS_NATIVE_ENABLED
  return JNI_TRUE;
#else
  return JNI_FALSE;
#endif
}

JNIEXPORT jint JNICALL
Java_expo_modules_cactusnative_CactusBridge_nativeLoadedModelsMask(JNIEnv*, jclass) {
#if CACTUS_NATIVE_ENABLED
  std::lock_guard<std::mutex> lock(g_cactus_mutex);
  return static_cast<jint>(cactus_models());
#else
  return 0;
#endif
}

JNIEXPORT jint JNICALL
Java_expo_modules_cactusnative_CactusBridge_nativeLoadModel(JNIEnv* env, jclass, jbyteArray jPath) {
#if CACTUS_NATIVE_ENABLED
  const std::string path = bytesToStdString(env, jPath);
  std::ifstream file(path, std::ios::binary | std::ios::ate);
  if (!file.is_open()) {
    throwRuntime(env, "Unable to open model weight file");
    return -1;
  }
  const std::streamsize size = file.tellg();
  if (size <= 0) {
    throwRuntime(env, "Model weight file is empty");
    return -1;
  }
  file.seekg(0, std::ios::beg);
  std::vector<unsigned char> buffer(static_cast<size_t>(size));
  if (!file.read(reinterpret_cast<char*>(buffer.data()), size)) {
    throwRuntime(env, "Failed to read model weight file");
    return -1;
  }

  std::lock_guard<std::mutex> lock(g_cactus_mutex);
  const int rc = cactus_load(buffer.data(), static_cast<unsigned long long>(buffer.size()));
  if (rc < 0) {
    const char* err = cactus_last_error();
    throwRuntime(env, (err && *err) ? err : "cactus_load failed");
    return rc;
  }
  return static_cast<jint>(cactus_models());
#else
  throwRuntime(env, "Cactus native library is only built for arm64-v8a and armeabi-v7a");
  return -1;
#endif
}

JNIEXPORT jint JNICALL
Java_expo_modules_cactusnative_CactusBridge_nativeInitText(
    JNIEnv* env,
    jclass,
    jbyteArray jSystemPrompt,
    jbyteArray jToolsJson) {
#if CACTUS_NATIVE_ENABLED
  const std::string systemPrompt = bytesToStdString(env, jSystemPrompt);
  const std::string toolsJson = bytesToStdString(env, jToolsJson);
  std::lock_guard<std::mutex> lock(g_cactus_mutex);
  const int rc = cactus_init(
      systemPrompt.empty() ? nullptr : systemPrompt.c_str(),
      toolsJson.c_str(),
      nullptr);
  if (rc < 0) {
    const char* err = cactus_last_error();
    throwRuntime(env, (err && *err) ? err : "cactus_init failed");
  }
  return rc;
#else
  throwRuntime(env, "Cactus native library is unsupported on this ABI");
  return -1;
#endif
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_cactusnative_CactusBridge_nativeComplete(
    JNIEnv* env,
    jclass,
    jbyteArray jInput,
    jint maxNewTokens) {
#if CACTUS_NATIVE_ENABLED
  const std::string input = bytesToStdString(env, jInput);
  std::lock_guard<std::mutex> lock(g_cactus_mutex);
  cactus_reset();
  std::vector<char> out(65536, '\0');
  const int rc = cactus_complete(
      input.c_str(),
      nullptr,
      0,
      static_cast<int>(maxNewTokens),
      out.data(),
      static_cast<int>(out.size()));
  if (rc < 0) {
    const char* err = cactus_last_error();
    const char* msg = (out[0] != '\0') ? out.data() : ((err && *err) ? err : "cactus_complete failed");
    throwRuntime(env, msg);
    return nullptr;
  }
  return stdStringToBytes(env, out.data());
#else
  throwRuntime(env, "Cactus native library is unsupported on this ABI");
  return nullptr;
#endif
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_cactusnative_CactusBridge_nativeTranscribe(
    JNIEnv* env,
    jclass,
    jfloatArray jPcm,
    jbyteArray jLanguage,
    jbyteArray jKeywords,
    jboolean wordTimestamps) {
#if CACTUS_NATIVE_ENABLED
  if (jPcm == nullptr) {
    throwRuntime(env, "PCM buffer is null");
    return nullptr;
  }
  const jsize len = env->GetArrayLength(jPcm);
  if (len <= 0) {
    return stdStringToBytes(env, "{\"text\":\"\",\"language\":\"\"}");
  }

  std::vector<float> pcm(static_cast<size_t>(len));
  env->GetFloatArrayRegion(jPcm, 0, len, pcm.data());

  const std::string language = bytesToStdString(env, jLanguage);
  const std::string keywords = bytesToStdString(env, jKeywords);
  const int estimatedCap = std::max(65536, (static_cast<int>(len) / 16000 + 2) * 4096);
  std::vector<char> out(static_cast<size_t>(estimatedCap), '\0');

  std::lock_guard<std::mutex> lock(g_cactus_mutex);
  const int rc = cactus_transcribe(
      pcm.data(),
      static_cast<int>(len),
      language.empty() ? nullptr : language.c_str(),
      keywords.empty() ? nullptr : keywords.c_str(),
      wordTimestamps == JNI_TRUE ? 1 : 0,
      out.data(),
      static_cast<int>(out.size()));
  if (rc < 0) {
    const char* err = cactus_last_error();
    throwRuntime(env, (err && *err) ? err : "cactus_transcribe failed");
    return nullptr;
  }
  return stdStringToBytes(env, out.data());
#else
  throwRuntime(env, "Cactus native library is unsupported on this ABI");
  return nullptr;
#endif
}

}
