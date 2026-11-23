import Foundation

/// React Native runs a TurboModule's void calls (`log`, `screen`, `setUser`) later, on the
/// module's method queue, and a call that returns a value (`logNow`) at once, on the JS thread.
/// A fatal error's event would overtake the logs JavaScript sent just before it, so it is put
/// behind them. Only Foundation here, so it can be checked on its own.
enum InOrder {
    /// Runs `work` on `queue`, behind every call already there, and waits for it (at most
    /// `timeoutMs`). If the queue doesn't get to it in time, runs it here instead. Either way
    /// exactly once, and done when this returns. On `queue` itself, runs it at once.
    static func behindQueued(_ queue: DispatchQueue, key: DispatchSpecificKey<Bool>, timeoutMs: Int, _ work: @escaping @Sendable () -> Void) {
        if DispatchQueue.getSpecific(key: key) == true {
            work()
            return
        }
        let claim = Claim()
        let done = DispatchSemaphore(value: 0)
        let wait = max(1, timeoutMs)
        queue.async {
            if claim.take() { work() }
            done.signal()
        }
        if done.wait(timeout: .now() + .milliseconds(wait)) == .success { return }
        if claim.take() {
            work()
        } else {
            // The queue took it just now: let it finish (logging is quick).
            _ = done.wait(timeout: .now() + .milliseconds(wait))
        }
    }

    private final class Claim: @unchecked Sendable {
        private let lock = NSLock()
        private var taken = false

        func take() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if taken { return false }
            taken = true
            return true
        }
    }
}
