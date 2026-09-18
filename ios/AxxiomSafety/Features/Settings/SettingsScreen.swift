import SwiftUI

struct SettingsScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ManualStore.self) private var manualStore
    @AppStorage("autoReadAloud") private var autoReadAloud = false
    @AppStorage("preferOnDeviceDictation") private var preferOnDevice = true
    @State private var showDisclaimer = false
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    LabeledContent("Signed in as", value: session.identifier ?? "")
                    Button("Sign out", role: .destructive) { confirmSignOut = true }
                }
                Section("Manual") {
                    switch manualStore.state {
                    case .ready(let v, let date, let pages):
                        LabeledContent("Version", value: v)
                        LabeledContent("Effective", value: date)
                        LabeledContent("Pages", value: "\(pages)")
                    case .downloading:
                        ProgressView("Downloading…")
                    default:
                        Text("Not downloaded")
                    }
                    Button("Check for updates") { Task { await manualStore.refreshIfNeeded(session: session) } }
                }
                Section("Preferences") {
                    Toggle("Read answers aloud automatically", isOn: $autoReadAloud)
                    Toggle("Keep dictation on this device", isOn: $preferOnDevice)
                }
                Section("About") {
                    LabeledContent("App version", value: (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "") + " (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""))")
                    if !AppEnvironment.current.isProduction { LabeledContent("Environment", value: AppEnvironment.current.name) }
                    Button("Disclaimer") { showDisclaimer = true }
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showDisclaimer) { DisclaimerText() }
            .confirmationDialog("Sign out and remove chat history from this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    Task { await session.signOut { PersistenceController.shared.wipeConversations() } }
                }
            }
        }
    }
}

struct DisclaimerText: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView { DisclaimerBody().padding(16) }
                .navigationTitle("Disclaimer")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }
}

struct DisclaimerBody: View {
    var body: some View {
        let text = (Bundle.main.url(forResource: "Disclaimer", withExtension: "md").flatMap { try? String(contentsOf: $0, encoding: .utf8) }) ?? "Follow the written policy and your supervisor."
        LightMarkdownView(blocks: LightMarkdown.parse(text))
    }
}
