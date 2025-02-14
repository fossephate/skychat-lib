#include <jni.h>
#include "skychat-lib.h"

extern "C"
JNIEXPORT jdouble JNICALL
Java_com_skychatlib_SkychatLibModule_nativeMultiply(JNIEnv *env, jclass type, jdouble a, jdouble b) {
    return skychatlib::multiply(a, b);
}
