import Foundation
import Observation

/// Where a citation should open the manual.
struct ManualDestination: Identifiable, Equatable {
    let id = UUID()
    let pageIndex: Int
    let quote: String?
    let label: String
}

/// App-wide navigation state: the manual reader cover and the emergency sheet.
@MainActor
@Observable
final class AppRouter {
    var manualDestination: ManualDestination?
    var emergencySheet: EmergencyPresentation?
    var selectedTab: Tab = .chat

    enum Tab: Hashable { case chat, manual, settings }
}

struct EmergencyPresentation: Identifiable, Equatable {
    let id = UUID()
    /// Text from an emergency-marked answer, shown at the top of the sheet.
    let answerText: String?
}
