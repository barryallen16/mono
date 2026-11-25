cmake_minimum_required(VERSION 3.13)

project(cactusnative)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CACTUS_DIR "${CMAKE_SOURCE_DIR}/third_party/cactus")
set(CACTUS_LIB_FILE "${CACTUS_DIR}/${ANDROID_ABI}/libcactus.a")

add_library(
  cactusnative
  SHARED
  src/main/cpp/cactus_jni.cpp
)

find_library(LOG_LIB log)

if(EXISTS "${CACTUS_LIB_FILE}")
  add_library(cactus_static STATIC IMPORTED)
  set_target_properties(
    cactus_static
    PROPERTIES IMPORTED_LOCATION "${CACTUS_LIB_FILE}"
  )
  target_include_directories(cactusnative PRIVATE "${CACTUS_DIR}/include")
  target_compile_definitions(cactusnative PRIVATE CACTUS_NATIVE_ENABLED=1)
  target_link_libraries(
    cactusnative
    cactus_static
    ${LOG_LIB}
    m
    dl
    android
  )
else()
  target_compile_definitions(cactusnative PRIVATE CACTUS_NATIVE_ENABLED=0)
  target_link_libraries(
    cactusnative
    ${LOG_LIB}
    android
  )
endif()
