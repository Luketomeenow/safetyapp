import SwiftUI

struct MessageRow: View {
    let message: MessageVM
    var model: ChatModel
    var readAloud: ReadAloudService
    @Environment(AppRouter.self) private var router

    var body: some View {
        if message.role == "user" {
            HStack {
                Spacer(minLength: 40)
                Text(message.text)
                    .padding(12)
                    .background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 14))
                    .accessibilityLabel("You asked: \(message.text)")
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if message.kind == "emergency" { emergencyBanner }
                if message.status == "streaming" {
                    Text(message.text.isEmpty ? " " : message.text)
                        .font(.body)
                        .accessibilityAddTraits(.updatesFrequently)
                } else if message.text.isEmpty {
                    Text(message.status == "failed" ? "No answer received." : "…").foregroundStyle(.secondary)
                } else {
                    LightMarkdownView(blocks: LightMarkdown.parse(message.text))
                }
                if message.interrupted {
                    Label("Answer was interrupted", systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
                }
                if message.kind == "not_covered" || message.kind == "out_of_scope" {
                    Label("The manual doesn't cover this", systemImage: "book.closed").font(.caption).foregroundStyle(.secondary)
                }
                if !message.citations.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(message.citations) { citation in
                            CitationCard(citation: citation) {
                                router.manualDestination = ManualDestination(pageIndex: citation.page, quote: citation.quote, label: citation.label)
                            }
                        }
                    }
                }
                if message.status == "complete" {
                    HStack(spacing: 12) {
                        if let v = message.manualVersionId {
                            Text("Manual \(v)\(message.manualEffectiveDate.map { " · effective \($0)" } ?? "")")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            readAloud.toggle(text: message.text, messageId: message.id)
                        } label: {
                            Image(systemName: readAloud.speakingMessageId == message.id ? "speaker.slash.fill" : "speaker.wave.2")
                        }
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel(readAloud.speakingMessageId == message.id ? "Stop reading aloud" : "Read answer aloud")
                    }
                    if message.serverId != nil { FeedbackBar(message: message, model: model) }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private var emergencyBanner: some View {
        Label("Emergency guidance. Call 911 if anyone is in danger.", systemImage: "exclamationmark.triangle.fill")
            .font(.subheadline.bold())
            .foregroundStyle(.white)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct CitationCard: View {
    let citation: CitationDTO
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "book.pages").foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 3) {
                    Text(citation.label).font(.subheadline.bold()).multilineTextAlignment(.leading)
                    if let q = citation.quote, !q.isEmpty {
                        Text("“\(q)”").font(.footnote).italic().foregroundStyle(.secondary).lineLimit(3).multilineTextAlignment(.leading)
                    }
                    Text("Open in manual").font(.caption).foregroundStyle(Color.accentColor)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding(10)
            .frame(minHeight: 44)
            .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(citation.accessibilityLabel)
        .accessibilityHint("Shows the page with the quoted passage highlighted")
    }
}

struct StatusPill: View {
    let phase: ChatModel.Phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if let text {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(text).font(.footnote)
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(Capsule().fill(Color(.secondarySystemBackground)))
            .padding(.bottom, 6)
            .transition(reduceMotion ? .identity : .opacity)
        }
    }

    private var text: String? {
        switch phase {
        case .sending: return "Sending…"
        case .readingManual: return "Reading the manual…"
        case .writing: return "Writing…"
        case .verifying: return "Checking the policy text…"
        default: return nil
        }
    }
}

struct InputBar: View {
    @Bindable var model: ChatModel
    @Bindable var dictation: DictationService

    var body: some View {
        VStack(spacing: 4) {
            if let e = dictation.errorMessage { Text(e).font(.caption).foregroundStyle(.orange) }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .bottom, spacing: 8) { field; controls }
                VStack(alignment: .trailing, spacing: 8) { field; HStack { controls } }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color(.systemBackground))
    }

    private var field: some View {
        TextField("Ask about a safety policy…", text: $model.draft, axis: .vertical)
            .lineLimit(1 ... 5)
            .textFieldStyle(.roundedBorder)
            .submitLabel(.send)
            .onSubmit { model.send() }
            .accessibilityIdentifier("question-field")
    }

    @ViewBuilder private var controls: some View {
        Button {
            dictation.toggle()
        } label: {
            Image(systemName: dictation.isRecording ? "mic.fill" : "mic")
                .foregroundStyle(dictation.isRecording ? Color.red : Color.accentColor)
        }
        .frame(minWidth: 44, minHeight: 44)
        .accessibilityLabel(dictation.isRecording ? "Stop dictation" : "Dictate a question")
        if model.isStreaming {
            Button { model.cancel() } label: { Image(systemName: "stop.circle.fill") }
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Stop answer")
        } else {
            Button { model.send() } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                .frame(minWidth: 44, minHeight: 44)
                .disabled(model.draft.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityLabel("Send")
                .accessibilityIdentifier("send-button")
        }
    }
}
