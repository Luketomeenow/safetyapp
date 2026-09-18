import SwiftUI
import UIKit

struct EmergencyContact: Codable, Identifiable {
    var id: String { label }
    let label: String
    let tel: String
    let note: String?

    static func bundled() -> [EmergencyContact] {
        guard let url = Bundle.main.url(forResource: "EmergencyContacts", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([EmergencyContact].self, from: data)) ?? []
    }
}

struct EmergencySheet: View {
    let presentation: EmergencyPresentation
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var contacts = EmergencyContact.bundled()
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button {
                        call("911")
                    } label: {
                        Label("Call 911", systemImage: "phone.fill")
                            .font(.title2.bold())
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 64)
                            .background(Color.red, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .accessibilityIdentifier("call-911")
                    if copied { Text("911 copied. Dial it from the Phone app.").font(.footnote) }

                    if let text = presentation.answerText {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("From the manual").font(.headline)
                            Text(text).font(.body)
                        }
                        .padding(12)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Company contacts").font(.headline)
                        ForEach(contacts) { c in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(c.label).font(.subheadline.bold())
                                    if let n = c.note, c.tel.isEmpty { Text(n).font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                if !c.tel.isEmpty {
                                    Button { call(c.tel) } label: { Label("Call", systemImage: "phone") }
                                        .buttonStyle(.borderedProminent)
                                        .frame(minHeight: 44)
                                }
                            }
                        }
                    }

                    Text("Do not put yourself in danger to help. Notify your supervisor as soon as it is safe, and report incidents through the official reporting procedure.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .padding(16)
            }
            .navigationTitle("Emergency")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    private func call(_ number: String) {
        guard let url = URL(string: "tel:\(number)") else { return }
        openURL(url) { accepted in
            if !accepted {
                UIPasteboard.general.string = number
                copied = true
            }
        }
    }
}
