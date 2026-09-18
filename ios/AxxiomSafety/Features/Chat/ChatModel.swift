import Foundation
import Observation
import SwiftData

struct MessageVM: Identifiable, Equatable {
    let id: UUID
    var role: String
    var text: String
    var status: String
    var kind: String?
    var serverId: String?
    var citations: [CitationDTO] = []
    var manualVersionId: String?
    var manualEffectiveDate: String?
    var feedbackRating: String?
    var feedbackFlagged = false
    var interrupted: Bool { status == "interrupted" }
}

/// Drives one conversation: sends questions, applies streamed events at a bounded rate, persists on completion.
@MainActor
@Observable
final class ChatModel {
    enum Phase: Equatable { case idle, sending, readingManual, writing, verifying, failed(ChatFailure) }

    private(set) var phase: Phase = .idle
    private(set) var messages: [MessageVM] = []
    var draft = ""
    private(set) var conversationId: String?
    private(set) var pendingEmergency: EmergencyDTO?
    private var streamTask: Task<Void, Never>?
    private var buffer = ""
    private var flushTask: Task<Void, Never>?
    private let transport: any ChatTransport
    private let context: ModelContext
    private let clientVersion: String

    init(transport: any ChatTransport, context: ModelContext, clientVersion: String, conversation: Conversation? = nil) {
        self.transport = transport
        self.context = context
        self.clientVersion = clientVersion
        if let conversation { load(conversation) }
    }

    var isStreaming: Bool { streamTask != nil }

    private func load(_ conversation: Conversation) {
        conversationId = conversation.id
        messages = conversation.messages.sorted { $0.createdAt < $1.createdAt }.map { m in
            MessageVM(id: m.id, role: m.role, text: m.text, status: m.status, kind: m.kind, serverId: m.serverId,
                      citations: m.citations.sorted { $0.order < $1.order }.map(\.dto), manualVersionId: m.manualVersionId,
                      manualEffectiveDate: m.manualEffectiveDate, feedbackRating: m.feedbackRating, feedbackFlagged: m.feedbackFlagged)
        }
    }

    func send() {
        let question = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty, streamTask == nil else { return }
        draft = ""
        pendingEmergency = nil
        let clientMessageId = UUID().uuidString
        let user = MessageVM(id: UUID(), role: "user", text: question, status: "complete")
        var assistant = MessageVM(id: UUID(), role: "assistant", text: "", status: "streaming")
        messages.append(user)
        messages.append(assistant)
        phase = .sending
        let request = ChatRequest(conversationId: conversationId, clientMessageId: clientMessageId, message: question, deviceId: nil, clientVersion: clientVersion)
        streamTask = Task { [weak self] in
            guard let self else { return }
            var provisional: [CitationDTO] = []
            var done: DoneDTO?
            var replaced: String?
            var failure: ChatFailure?
            do {
                for try await event in transport.send(request) {
                    switch event {
                    case .status(let s):
                        phase = s.stage == "writing" ? .writing : s.stage == "verifying" ? .verifying : .readingManual
                    case .text(let delta):
                        buffer += delta
                        scheduleFlush(assistantId: assistant.id)
                    case .citation(let c):
                        if !provisional.contains(where: { $0.page == c.page }) {
                            provisional.append(c)
                            update(assistant.id) { $0.citations = provisional }
                        }
                    case .emergency(let e):
                        pendingEmergency = e
                    case .replace(let r):
                        replaced = r.text
                    case .done(let d):
                        done = d
                    case .error(let e):
                        failure = e.code == "conversation_closed" ? .conversationClosed : .unavailable(message: e.message)
                    case .unknown:
                        break
                    }
                }
            } catch let e as ChatFailure {
                failure = e
            } catch {
                failure = .unavailable(message: "The assistant hit an unexpected error. Use the manual in the app.")
            }
            flushNow(assistantId: assistant.id)
            if let done {
                conversationId = done.conversationId
                update(assistant.id) {
                    if let replaced { $0.text = replaced }
                    $0.status = "complete"
                    $0.kind = done.kind
                    $0.serverId = done.messageId
                    $0.citations = done.citations
                    $0.manualVersionId = done.manual.versionId
                    $0.manualEffectiveDate = done.manual.effectiveDate
                }
                if done.isEmergency, pendingEmergency == nil {
                    pendingEmergency = EmergencyDTO(headline: "Emergency", steps: [], call: .init(label: "Call 911", tel: "911"), contacts: [], citations: [])
                }
                phase = .idle
            } else {
                let f = failure ?? .interrupted
                update(assistant.id) { m in
                    m.status = m.text.isEmpty ? "failed" : "interrupted"
                }
                phase = f == .cancelled ? .idle : .failed(f)
            }
            assistant = messages.first(where: { $0.id == assistant.id }) ?? assistant
            persist(user: user, assistant: assistant, question: question)
            streamTask = nil
        }
    }

    func cancel() {
        streamTask?.cancel()
    }

    func retryLast() {
        guard let lastUser = messages.last(where: { $0.role == "user" }) else { return }
        if let idx = messages.lastIndex(where: { $0.role == "assistant" }), idx > messages.firstIndex(where: { $0.id == lastUser.id }) ?? -1 {
            messages.remove(at: idx)
        }
        messages.removeAll { $0.id == lastUser.id }
        draft = lastUser.text
        send()
    }

    private func scheduleFlush(assistantId: UUID) {
        guard flushTask == nil else { return }
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(50))
            self?.flushNow(assistantId: assistantId)
        }
    }

    private func flushNow(assistantId: UUID) {
        flushTask?.cancel()
        flushTask = nil
        guard !buffer.isEmpty else { return }
        let chunk = buffer
        buffer = ""
        update(assistantId) { $0.text += chunk }
    }

    private func update(_ id: UUID, _ change: (inout MessageVM) -> Void) {
        guard let i = messages.firstIndex(where: { $0.id == id }) else { return }
        change(&messages[i])
    }

    private func persist(user: MessageVM, assistant: MessageVM, question: String) {
        let conversation: Conversation
        if let id = conversationId, let existing = try? context.fetch(FetchDescriptor<Conversation>(predicate: #Predicate { $0.id == id })).first {
            conversation = existing
        } else {
            conversation = Conversation(id: conversationId ?? UUID().uuidString, title: String(question.prefix(80)))
            context.insert(conversation)
        }
        conversation.updatedAt = .now
        let u = Message(id: user.id, role: "user", text: user.text, status: "complete")
        u.conversation = conversation
        context.insert(u)
        let a = Message(id: assistant.id, role: "assistant", text: assistant.text, status: assistant.status)
        a.kind = assistant.kind
        a.serverId = assistant.serverId
        a.manualVersionId = assistant.manualVersionId
        a.manualEffectiveDate = assistant.manualEffectiveDate
        a.citations = assistant.citations.enumerated().map { Citation(dto: $1, order: $0) }
        a.conversation = conversation
        context.insert(a)
        try? context.save()
    }

    func recordFeedback(messageId: UUID, rating: String?, flagged: Bool) {
        update(messageId) { m in
            if let rating { m.feedbackRating = rating }
            if flagged { m.feedbackFlagged = true }
        }
        if let m = try? context.fetch(FetchDescriptor<Message>(predicate: #Predicate { $0.id == messageId })).first {
            if let rating { m.feedbackRating = rating }
            if flagged { m.feedbackFlagged = true }
            try? context.save()
        }
    }
}
