import SwiftUI

/// Shown after first sign-in and whenever the disclaimer version changes.
struct DisclaimerGate: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        VStack(spacing: 0) {
            ScrollView { DisclaimerBody().padding(20) }
            Button {
                session.acceptDisclaimer()
            } label: {
                Text("I understand").font(.headline).frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.borderedProminent)
            .padding(20)
            .accessibilityIdentifier("accept-disclaimer")
        }
    }
}
