import SwiftUI

struct EmergencyButton: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        Button {
            router.emergencySheet = EmergencyPresentation(answerText: nil)
        } label: {
            Label("Emergency", systemImage: "exclamationmark.triangle.fill")
                .font(.headline)
                .foregroundStyle(.white)
                .padding(.horizontal, 18)
                .frame(minHeight: 56)
                .background(Color.red, in: Capsule())
                .shadow(radius: 4, y: 2)
        }
        .accessibilityLabel("Emergency: call 911 and see emergency contacts")
        .accessibilityIdentifier("emergency-button")
    }
}
