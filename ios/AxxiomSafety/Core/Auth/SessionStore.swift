import Foundation
import Observation

/// Sign-in state for the whole app, plus the disclaimer acceptance record.
@MainActor
@Observable
final class SessionStore: TokenProviding {
    enum State: Equatable { case unknown, signedOut, signedIn(identifier: String) }

    private(set) var state: State = .unknown
    private(set) var disclaimerAccepted = false
    var signInError: String?
    let provider: any AuthProviding
    let disclaimerVersion = "2026-09-01"

    init(provider: any AuthProviding) {
        self.provider = provider
    }

    lazy var api = APIClient(baseURL: AppEnvironment.current.apiBaseURL, tokens: self)

    func restore() async {
        if let id = await provider.restore() {
            state = .signedIn(identifier: id)
            disclaimerAccepted = UserDefaults.standard.string(forKey: "acceptedDisclaimer.\(id)") == disclaimerVersion
        } else {
            state = .signedOut
        }
    }

    func signIn(email: String, password: String) async {
        signInError = nil
        do {
            let id = try await provider.signIn(email: email, password: password)
            state = .signedIn(identifier: id)
            disclaimerAccepted = UserDefaults.standard.string(forKey: "acceptedDisclaimer.\(id)") == disclaimerVersion
        } catch {
            signInError = (error as? LocalizedError)?.errorDescription ?? "Sign-in failed."
        }
    }

    func acceptDisclaimer() {
        guard case .signedIn(let id) = state else { return }
        UserDefaults.standard.set(disclaimerVersion, forKey: "acceptedDisclaimer.\(id)")
        disclaimerAccepted = true
    }

    func signOut(wipeLocalData: () -> Void) async {
        await provider.signOut()
        wipeLocalData()
        state = .signedOut
        disclaimerAccepted = false
    }

    var identifier: String? {
        if case .signedIn(let id) = state { return id }
        return nil
    }

    // TokenProviding
    nonisolated func accessToken() async throws -> String { try await provider.accessToken() }
    nonisolated func forceRefresh() async throws -> String { try await provider.forceRefresh() }
    nonisolated func sessionExpired() async {
        await MainActor.run { self.state = .signedOut }
    }
}
