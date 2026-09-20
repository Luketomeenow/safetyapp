import SwiftUI

struct RootView: View {
    @Environment(SessionStore.self) private var session
    @Environment(AppRouter.self) private var router
    @Environment(ManualStore.self) private var manualStore

    var body: some View {
        @Bindable var router = router
        Group {
            switch session.state {
            case .unknown:
                ProgressView("Signing in…")
            case .signedOut:
                SignInScreen()
            case .signedIn:
                if !session.disclaimerAccepted {
                    DisclaimerGate()
                } else {
                    mainTabs
                }
            }
        }
        .fullScreenCover(item: $router.manualDestination) { destination in
            ManualReaderScreen(destination: destination)
        }
        .sheet(item: $router.emergencySheet) { presentation in
            EmergencySheet(presentation: presentation)
        }
        .task(id: session.state) {
            if case .signedIn = session.state {
                await manualStore.refreshIfNeeded(session: session)
            }
        }
    }

    private var mainTabs: some View {
        @Bindable var router = router
        return ZStack(alignment: .bottomTrailing) {
            TabView(selection: $router.selectedTab) {
                ChatScreen()
                    .tabItem { Label("Chat", systemImage: "bubble.left.and.text.bubble.right") }
                    .tag(AppRouter.Tab.chat)
                ManualScreen()
                    .tabItem { Label("Manual", systemImage: "book.closed") }
                    .tag(AppRouter.Tab.manual)
                SettingsScreen()
                    .tabItem { Label("Settings", systemImage: "gearshape") }
                    .tag(AppRouter.Tab.settings)
            }
            // Clears the tab bar and the chat input row: the button must never sit over the
            // send or microphone controls, or a technician taps Emergency while asking a question.
            EmergencyButton()
                .padding(.trailing, 16)
                .padding(.bottom, 150)
        }
    }
}
