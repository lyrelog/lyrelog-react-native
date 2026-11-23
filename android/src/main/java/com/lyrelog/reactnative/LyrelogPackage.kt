package com.lyrelog.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class LyrelogPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == LyrelogModule.NAME) LyrelogModule(reactContext) else null

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(
            LyrelogModule.NAME to ReactModuleInfo(
                LyrelogModule.NAME,
                LyrelogModule::class.java.name,
                false, // canOverrideExistingModule
                false, // needsEagerInit
                false, // isCxxModule
                true, // isTurboModule
            ),
        )
    }
}
