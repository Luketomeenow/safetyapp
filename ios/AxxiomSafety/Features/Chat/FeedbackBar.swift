import SwiftUI

struct FeedbackBar: View {
    let message: MessageVM
    var model: ChatModel
    @Environment(SessionStore.self) private var session
    @State private var showFlag = false
    @State private var comment = ""
    @State private var sending = false

    var body: some View {
        HStack(spacing: 8) {
            rate("up", "hand.thumbsup", "Helpful")
            rate("down", "hand.thumbsdown", "Not helpful")
            Button { showFlag = true } label: {
                Label(message.feedbackFlagged ? "Reported" : "This is wrong", systemImage: "flag")
                    .font(.caption)
            }
            .disabled(message.feedbackFlagged)
            .frame(minHeight: 44)
            Spacer()
        }
        .sheet(isPresented: $showFlag) {
            NavigationStack {
                Form {
                    Section("What was wrong?") {
                        TextField("Optional comment for the Safety Manager", text: $comment, axis: .vertical).lineLimit(3 ... 6)
                    }
                    Text("Your report and the answer go to the Safety Manager for review.").font(.footnote).foregroundStyle(.secondary)
                }
                .navigationTitle("Report answer")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showFlag = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Send") { Task { await submit(rating: nil, flag: "wrong") } }.disabled(sending)
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private func rate(_ value: String, _ icon: String, _ label: String) -> some View {
        Button {
            Task { await submit(rating: value, flag: nil) }
        } label: {
            Image(systemName: message.feedbackRating == value ? "\(icon).fill" : icon)
        }
        .frame(minWidth: 44, minHeight: 44)
        .disabled(sending)
        .accessibilityLabel(label)
    }

    private func submit(rating: String?, flag: String?) async {
        guard let serverId = message.serverId else { return }
        sending = true
        defer { sending = false }
        let request = FeedbackRequest(messageId: serverId, rating: rating, flag: flag, comment: comment.isEmpty ? nil : comment)
        _ = try? await session.api.sendFeedback(request)
        model.recordFeedback(messageId: message.id, rating: rating, flagged: flag != nil)
        showFlag = false
        comment = ""
    }
}
