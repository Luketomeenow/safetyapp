import SwiftUI

struct SignInScreen: View {
    @Environment(SessionStore.self) private var session
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Work email", text: $email)
                        .textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                        .accessibilityIdentifier("email-field")
                    SecureField("Password", text: $password)
                        .textContentType(.password)
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
