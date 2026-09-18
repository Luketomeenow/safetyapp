import Auth
import Foundation

/// Supabase Auth (email + password) with Keychain-backed session storage and automatic refresh.
final class SupabaseAuthProvider: AuthProviding, @unchecked Sendable {
    private let client: AuthClient

    init(environment: AppEnvironment) {
        client = AuthClient(
            url: environment.supabaseURL.appending(path: "auth/v1"),
            headers: ["apikey": environment.supabaseAnonKey],
            localStorage: KeychainLocalStorage(service: "com.axxiomelevator.safetyassistant.auth", accessGroup: nil),
            autoRefreshToken: true
        )
    }

    func restore() async -> String? {
        do {
            let session = try await client.session
            return session.user.email ?? session.user.id.uuidString
        } catch {
            return nil
        }
    }

    func signIn(email: String, password: String) async throws -> String {
        do {
            let session = try await client.signIn(email: email, password: password)
            return session.user.email ?? session.user.id.uuidString
        } catch let error as AuthError {
            if case .api(let message, _, _, _) = error, message.localizedCaseInsensitiveContains("invalid") {
                throw AuthFailure.invalidCredentials
            }
            throw AuthFailure.network(error.localizedDescription)
        } catch {
            throw AuthFailure.network(error.localizedDescription)
        }
    }

    func signOut() async {
        try? await client.signOut()
    }

    func accessToken() async throws -> String {
        do {
            return try await client.session.accessToken // refreshes when expired
        } catch {
            throw AuthFailure.notSignedIn
        }
    }

    func forceRefresh() async throws -> String {
        do {
            return try await client.refreshSession().accessToken
        } catch {
            throw AuthFailure.notSignedIn
        }
    }
}
