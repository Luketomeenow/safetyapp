import Foundation

/// User-facing failure states for the chat screen.
enum ChatFailure: Error, Equatable {
    case offline
    case interrupted
    case unauthorized
    case forbidden
    case rateLimited(retryAfterSeconds: Int?)
    case unavailable(message: String)
    case conversationClosed
    case cancelled

    var title: String {
        switch self {
        case .offline: return "You're offline"
        case .interrupted: return "Connection lost"
        case .unauthorized: return "Please sign in again"
        case .forbidden: return "Account not enabled"
        case .rateLimited: return "Too many questions right now"
        case .unavailable: return "Assistant unavailable"
        case .conversationClosed: return "This conversation is closed"
        case .cancelled: return ""
        }
    }

    var message: String {
        switch self {
        case .offline: return "The manual still works. Search it from the Manual tab."
        case .interrupted: return "Part of the answer arrived. Retry to get the rest."
        case .unauthorized: return "Your session expired."
        case .forbidden: return "Your account isn't enabled for the Safety Assistant. Contact IT."
        case .rateLimited(let s): return "Try again in \(s.map { "\($0 / 60 + 1) minutes" } ?? "a minute")."
        case .unavailable(let m): return m
        case .conversationClosed: return "Start a new conversation to keep going."
        case .cancelled: return ""
        }
    }

    /// Whether offering "Retry" makes sense for this failure.
    var isRetryable: Bool {
        switch self {
        case .offline, .interrupted, .rateLimited, .unavailable: return true
        case .unauthorized, .forbidden, .conversationClosed, .cancelled: return false
        }
    }

    static func from(status: Int, retryAfter: String?) -> ChatFailure? {
        switch status {
        case 200 ..< 300: return nil
        case 401: return .unauthorized
        case 403: return .forbidden
        case 409: return .conversationClosed
        case 429: return .rateLimited(retryAfterSeconds: retryAfter.flatMap(Int.init))
        default: return .unavailable(message: "The assistant is unavailable right now. Use the manual in the app.")
        }
    }

    static func from(urlError: URLError, receivedBytes: Bool) -> ChatFailure {
        switch urlError.code {
        case .cancelled: return .cancelled
        case .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .timedOut where !receivedBytes:
            return .offline
        case .networkConnectionLost, .timedOut:
            return .interrupted
        default:
            return receivedBytes ? .interrupted : .offline
        }
    }
}
