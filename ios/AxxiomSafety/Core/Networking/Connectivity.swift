import Foundation
import Network
import Observation

/// Tracks whether the network path is usable; `-forceOffline` launch argument simulates a machine room.
@MainActor
@Observable
final class Connectivity {
    private(set) var isOnline = true
    private let monitor = NWPathMonitor()
    private let forced = ProcessInfo.processInfo.arguments.contains("-forceOffline")

    func start() {
        if forced {
            isOnline = false
            return
        }
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.isOnline = online }
        }
        monitor.start(queue: DispatchQueue(label: "connectivity"))
    }
}
