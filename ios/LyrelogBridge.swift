import Foundation
@_spi(Wrapper) import Lyrelog

/// The Objective-C++ module's way into the Lyrelog Swift SDK (a Swift-only API). Values arrive
/// as Foundation objects from JavaScript and are turned into `Lyrelog.LogValue`s here. Nothing throws.
@objc(LyrelogBridge)
public final class LyrelogBridge: NSObject {
    @objc public static func start(_ config: NSDictionary) {
        guard let configuration = configuration(config) else { return }
        Lyrelog.start(configuration)
    }

    @objc public static func log(_ level: String, message: String, category: String?, attrs: NSDictionary?, payload: NSDictionary?) {
        Lyrelog.log(logLevel(level), message, category: category, attrs: attributes(attrs), payload: unwrap(payload))
    }

    /// Logs, then waits (at most `timeoutMs`) until it's on disk and an upload was tried: a fatal
    /// JavaScript error is about to end the app. Called on the JavaScript thread, never the main one.
    @objc public static func logNow(_ level: String, message: String, category: String?, attrs: NSDictionary?, payload: NSDictionary?, timeoutMs: Double) -> Bool {
        let total = Int(max(1, min(timeoutMs, 5000)))
        let start = DispatchTime.now()
        let severity = logLevel(level)
        let fields = attributes(attrs)
        let value = unwrap(payload)
        // Behind the log calls still waiting on the method queue, so the last events before the
        // crash keep their order (a third of the time at most, 500 ms).
        InOrder.behindQueued(methodQueue, key: methodQueueKey, timeoutMs: min(total / 3, 500)) {
            Lyrelog.log(severity, message, category: category, attrs: fields, payload: value)
        }
        let done = DispatchSemaphore(value: 0)
        Task.detached {
            await Lyrelog.flush()
            done.signal()
        }
        let spent = Int((DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000)
        return done.wait(timeout: .now() + .milliseconds(max(1, total - spent))) == .success
    }

    /// The TurboModule's method queue (`RNLyrelog.methodQueue`): its own, so `logNow` waits only
    /// for Lyrelog's calls, not other modules' (React Native's shared queue).
    @objc public static let methodQueue: DispatchQueue = {
        let queue = DispatchQueue(label: "com.lyrelog.reactnative", qos: .utility)
        queue.setSpecific(key: methodQueueKey, value: true)
        return queue
    }()

    static let methodQueueKey = DispatchSpecificKey<Bool>()

    @objc public static func setUser(_ id: String?) {
        Lyrelog.setUser(id)
    }

    @objc public static func setConsent(_ consent: String) {
        guard let value = Self.consent(consent) else { return }
        Lyrelog.setConsent(value)
    }

    @objc public static func screen(_ name: String, attrs: NSDictionary?) {
        Lyrelog.screen(name, attrs: attributes(attrs))
    }

    @objc public static func flush(_ completion: @escaping @Sendable () -> Void) {
        Task.detached {
            await Lyrelog.flush()
            completion()
        }
    }

    @objc public static func stop(_ completion: @escaping @Sendable () -> Void) {
        Task.detached {
            await Lyrelog.stop()
            completion()
        }
    }

    @objc public static var sessionID: String? {
        Lyrelog.sessionID
    }

    // MARK: - Values

    /// This package's version, named in `resource.sdk` before the Swift SDK's (package.json).
    static let wrapperVersion = "1.0.0"

    static func configuration(_ map: NSDictionary) -> Lyrelog.Configuration? {
        guard let apiKey = map["apiKey"] as? String, !apiKey.isEmpty else { return nil }
        var configuration = Lyrelog.Configuration(apiKey: apiKey)
        configuration.wrapper = "lyrelog-react-native/\(wrapperVersion)"
        if let raw = map["endpoint"] as? String, let url = URL(string: raw) { configuration.endpoint = url }
        if let raw = map["consent"] as? String, let value = consent(raw) { configuration.consent = value }
        if let raw = map["minimumLevel"] as? String { configuration.minimumLevel = logLevel(raw) }
        if let value = map["environment"] as? String { configuration.environment = value }
        if let value = map["platform"] as? String { configuration.platform = value }
        if let ms = number(map["flushIntervalMs"]) { configuration.uploadInterval = .milliseconds(clamped(ms)) }
        if let ms = number(map["sessionTimeoutMs"]) { configuration.sessionTimeout = .milliseconds(clamped(ms)) }
        if let bytes = number(map["maxDiskBytes"]) { configuration.maxDiskBytes = Int(clamped(bytes)) }
        if let keys = map["redactKeys"] as? [Any] { configuration.redactedKeys = keys.compactMap { $0 as? String } }
        if let value = flag(map["captureCrashes"]) { configuration.captureDiagnostics = value }
        if let value = flag(map["attachScreen"]) { configuration.attachScreen = value }
        if let value = flag(map["attest"]) { configuration.appAttest = value }
        if let value = flag(map["mirrorToNativeLog"]) { configuration.mirrorToOSLog = value }
        return configuration
    }

    static func logLevel(_ name: String) -> Lyrelog.LogLevel {
        Lyrelog.LogLevel(rawValue: name) ?? .info
    }

    static func consent(_ name: String) -> Lyrelog.Consent? {
        switch name {
        case "granted": .granted
        case "pending": .pending
        case "denied": .denied
        default: nil
        }
    }

    static func attributes(_ map: NSDictionary?) -> [String: Lyrelog.LogValue] {
        guard let map else { return [:] }
        var out: [String: Lyrelog.LogValue] = [:]
        for (key, value) in map {
            guard let key = key as? String else { continue }
            out[key] = logValue(value)
        }
        return out
    }

    /// The payload crosses as `{ value }` so any JSON value fits.
    static func unwrap(_ payload: NSDictionary?) -> Lyrelog.LogValue? {
        guard let payload, let value = payload["value"] else { return nil }
        return logValue(value)
    }

    static func logValue(_ value: Any) -> Lyrelog.LogValue {
        switch value {
        case let string as String:
            return .string(string)
        case let number as NSNumber:
            // JavaScript booleans arrive as NSNumber too: tell them apart by their CF type.
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
            let double = number.doubleValue
            if double.rounded() == double, abs(double) < 9_007_199_254_740_992 { return .int(Int(double)) }
            return .double(double)
        case let array as [Any]:
            return .array(array.map(logValue))
        case let map as NSDictionary:
            return .object(attributes(map))
        default:
            return .null
        }
    }

    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        return double.isFinite && double > 0 ? double : nil
    }

    /// `Int64(_:)` traps on a Double past its range; this never does (the values are positive and finite).
    static func clamped(_ value: Double) -> Int64 {
        // Double(Int64.max) rounds up to 2^63, which Int64 can't hold.
        if value >= Double(Int64.max) { return .max }
        if value <= Double(Int64.min) { return .min }
        return Int64(value)
    }

    private static func flag(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }
}
