package com.lyrelog.reactnative

import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.lyrelog.Configuration
import com.lyrelog.Consent
import com.lyrelog.Level
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ConfigurationTest {
    @Test
    fun takesWhatJavascriptSetAndKeepsTheSdkDefaultsForTheRest() {
        val map = JavaOnlyMap.of(
            "apiKey", "lyr_ing_test",
            "endpoint", "http://10.0.2.2:8090",
            "consent", "pending",
            "minimumLevel", "warning",
            "flushIntervalMs", 5000.0,
            "redactKeys", JavaOnlyArray.of("pin", 3.0),
            "attest", false,
            "mirrorToNativeLog", true,
        )
        val configuration = LyrelogModule.configuration(map)!!
        val defaults = Configuration("lyr_ing_test")
        assertEquals("lyr_ing_test", configuration.apiKey)
        assertEquals("http://10.0.2.2:8090", configuration.endpoint)
        assertEquals(Consent.PENDING, configuration.consent)
        assertEquals(Level.WARNING, configuration.minimumLevel)
        assertEquals(5000L, configuration.flushIntervalMillis)
        assertEquals(listOf("pin"), configuration.redactedKeys)
        assertEquals(false, configuration.attest)
        assertEquals(true, configuration.mirrorToLogcat)
        assertEquals(defaults.sessionTimeoutMillis, configuration.sessionTimeoutMillis)
        assertEquals(defaults.captureCrashes, configuration.captureCrashes)
        assertEquals(defaults.environment, configuration.environment)
    }

    @Test
    fun namesThisPackageInResourceSdk() {
        val configuration = LyrelogModule.configuration(JavaOnlyMap.of("apiKey", "k"))!!
        assertEquals("lyrelog-react-native/1.0.0", configuration.wrapper)
        assertEquals("1.0.0", LyrelogModule.WRAPPER_VERSION)
    }

    @Test
    fun needsAKey() {
        assertNull(LyrelogModule.configuration(JavaOnlyMap.of("endpoint", "https://ingest.lyrelog.com")))
    }
}
