import Foundation
import SwiftData

@MainActor
final class PersistenceController {
    static let shared = PersistenceController()
    let container: ModelContainer

    private init() {
        let schema = Schema([Conversation.self, Message.self, Citation.self, ManualVersionRecord.self])
        let inMemory = ProcessInfo.processInfo.arguments.contains("-resetState")
        let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: inMemory)
        do {
            container = try ModelContainer(for: schema, configurations: [config])
        } catch {
            // A corrupt store on a pilot device must not brick the app: fall back to memory.
            container = try! ModelContainer(for: schema, configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)])
        }
    }

    /// Sign-out: remove chat history but keep the downloaded manual record.
    func wipeConversations() {
        let context = container.mainContext
        try? context.delete(model: Message.self)
        try? context.delete(model: Conversation.self)
        try? context.save()
    }
}
