import SwiftData
import SwiftUI

struct ConversationListScreen: View {
    @Query(sort: \Conversation.updatedAt, order: .reverse) private var conversations: [Conversation]
    @Environment(\.dismiss) private var dismiss
    let select: (Conversation) -> Void

    var body: some View {
        NavigationStack {
            List(conversations) { c in
                Button { select(c) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.title).lineLimit(2)
                        Text(c.updatedAt, style: .relative).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .frame(minHeight: 44)
            }
            .overlay { if conversations.isEmpty { ContentUnavailableView("No conversations yet", systemImage: "bubble.left") } }
            .navigationTitle("Conversations")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
    }
}
