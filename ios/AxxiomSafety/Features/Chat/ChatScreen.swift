import SwiftData
import SwiftUI

struct ChatScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(Connectivity.self) private var connectivity
    @Environment(AppRouter.self) private var router
    @Environment(\.modelContext) private var context
    @State private var model: ChatModel?
    @State private var showHistory = false
    @State private var dictation = DictationService()
    @State private var readAloud = ReadAloudService()

    var body: some View {
        NavigationStack {
            Group {
                if let model {
                    ChatConversationView(model: model, dictation: dictation, readAloud: readAloud)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Safety Assistant")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showHistory = true } label: { Label("Conversations", systemImage: "clock.arrow.circlepath") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { startNew() } label: { Label("New conversation", systemImage: "square.and.pencil") }
                }
            }
            .sheet(isPresented: $showHistory) {
                ConversationListScreen { conversation in
                    model = ChatModel(transport: session.api, context: context, clientVersion: session.api.clientVersion, conversation: conversation)
                    showHistory = false
                }
            }
        }
        .task {
            if model == nil { startNew() }
        }
        .onChange(of: model?.pendingEmergency) { _, emergency in
            if let emergency {
                let text = ([emergency.headline] + emergency.steps.map { "• \($0)" }).joined(separator: "\n")
                router.emergencySheet = EmergencyPresentation(answerText: emergency.steps.isEmpty ? nil : text)
            }
        }
    }

    private func startNew() {
        model = ChatModel(transport: session.api, context: context, clientVersion: session.api.clientVersion)
    }
}

struct ChatConversationView: View {
    @Bindable var model: ChatModel
    @Bindable var dictation: DictationService
    var readAloud: ReadAloudService
    @Environment(Connectivity.self) private var connectivity
    @Environment(AppRouter.self) private var router
    @Environment(SessionStore.self) private var session

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if model.messages.isEmpty { welcome }
                        ForEach(model.messages) { message in
                            MessageRow(message: message, model: model, readAloud: readAloud)
                                .id(message.id)
                        }
                        if case .failed(let failure) = model.phase, failure != .cancelled {
                            failureCard(failure)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                .defaultScrollAnchor(.bottom)
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: model.messages.last?.text) { _, _ in
                    if let last = model.messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
            StatusPill(phase: model.phase)
            if connectivity.isOnline {
                InputBar(model: model, dictation: dictation)
            } else {
                offlineBar
            }
        }
        .onChange(of: dictation.transcript) { _, t in
            if !t.isEmpty { model.draft = t }
        }
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ask a safety policy question").font(.headline)
            Text("Answers come only from the Axxiom Safety and Health Policies manual, with the exact policy text and page you can open. For anything happening right now, use the Emergency button.")
                .font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.vertical, 24)
    }

    private var offlineBar: some View {
        HStack {
            Image(systemName: "wifi.slash")
            Text("Offline. The manual still works.").font(.subheadline)
            Spacer()
            Button("Search the manual") { router.selectedTab = .manual }.font(.subheadline.bold())
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
    }

    private func failureCard(_ failure: ChatFailure) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(failure.title).font(.subheadline.bold())
            Text(failure.message).font(.subheadline).foregroundStyle(.secondary)
            HStack {
                if failure.isRetryable {
                    Button("Retry") { model.retryLast() }
                }
                if failure == .offline { Button("Search the manual") { router.selectedTab = .manual } }
                if failure == .unauthorized { Button("Sign in") { Task { await session.sessionExpired() } } }
            }
            .font(.subheadline.bold())
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
    }
}
