import Foundation

enum AuthEvent: Sendable { case signedIn, signedOut }

/// Identity provider abstraction: Supabase Auth for the pilot, the company IdP (MSAL or AppAuth) later.
protocol AuthProviding: AnyObject, Sendable {
    /// Restores a persisted session; returns the user's display identifier when signed in.
    func restore() async -> String?
    func signIn(email: String, password: String) async throws -> String
    func signOut() async
    func accessToken() async throws -> String
    func forceRefresh() async throws -> String
}

enum AuthFailure: LocalizedError {
    case invalidCredentials
    case notSignedIn
    case network(String)

    var errorDescription: String? {
        switch self {
        case .invalidCredentials: return "Email or password is incorrect."
        case .notSignedIn: return "Please sign in."
        case .network(let m): return m
        }
    }
}
