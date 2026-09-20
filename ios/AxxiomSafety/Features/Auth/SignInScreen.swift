import SwiftUI

struct SignInScreen: View {
    @Environment(SessionStore.self) private var session
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    /// Suppresses the system "Save Password?" sheet, which covers the app during automated runs.
    private let isUITesting = ProcessInfo.processInfo.arguments.contains("-uiTesting")

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Work email", text: $email)
                        .textContentType(isUITesting ? nil : .username).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                        .accessibilityIdentifier("email-field")
                    SecureField("Password", text: $password)
                        .textContentType(isUITesting ? nil : .password)
                        .accessibilityIdentifier("password-field")
                }
                if let error = session.signInError { Text(error).foregroundStyle(.red) }
                Section {
                    Button {
                        busy = true
                        Task {
                            await session.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
                            busy = false
                        }
                    } label: {
                        HStack { Spacer(); if busy { ProgressView() } else { Text("Sign in").bold() }; Spacer() }
                            .frame(minHeight: 44)
                    }
                    .disabled(busy || email.isEmpty || password.isEmpty)
                    .accessibilityIdentifier("sign-in-button")
                }
                Section {
                    Text("Accounts are issued by Axxiom. If you cannot sign in, contact your supervisor or IT.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Axxiom Safety")
        }
    }
}
