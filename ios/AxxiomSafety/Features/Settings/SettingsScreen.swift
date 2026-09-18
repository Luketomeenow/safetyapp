import SwiftUI

struct SettingsScreen: View {
    @Environment(SessionStore.self) private var session
    @Environment(ManualStore.self) private var manualStore
    @AppStorage("autoReadAloud") private var autoReadAloud = false
    @AppStorage("preferOnDeviceDictation") private var preferOnDevice = true
    @State private var showDisclaimer = false
    @State private var confirmSignOut = false
    @State private var showDataRequest = false

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
                Section("Privacy") {
                    if let url = AppEnvironment.current.privacyPolicyURL {
                        Link("Privacy policy", destination: url).frame(minHeight: 44)
                    }
                    Button("Request my data or account deletion") { showDataRequest = true }
                        .frame(minHeight: 44)
                    Text("Questions and answers are kept as safety records. Your account is issued and removed by Axxiom.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("About") {
                    LabeledContent("App version", value: (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "") + " (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""))")
                    if !AppEnvironment.current.isProduction { LabeledContent("Environment", value: AppEnvironment.current.name) }
                    Button("Disclaimer") { showDisclaimer = true }
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showDisclaimer) { DisclaimerText() }
            .confirmationDialog("Your Axxiom account and safety records are managed by the company.", isPresented: $showDataRequest, titleVisibility: .visible) {
                Link("Email the Safety Manager", destination: URL(string: "mailto:\(AppEnvironment.current.supportEmail)?subject=Safety%20Assistant%20data%20request")!)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("To see the data held about you, or to have your account and chat history deleted, email the Safety Manager. Requests are actioned within 30 days.")
            }
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
