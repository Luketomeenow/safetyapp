import Foundation

/// Supplies bearer tokens; implemented by SessionStore.
protocol TokenProviding: AnyObject, Sendable {
    func accessToken() async throws -> String
    func forceRefresh() async throws -> String
    func sessionExpired() async
}

/// HTTP client for the Axxiom API: JSON calls plus a server-sent-events stream for chat.
final class APIClient: Sendable {
    let baseURL: URL
    private let tokens: any TokenProviding
    private let session: URLSession
    let clientVersion: String

    init(baseURL: URL, tokens: any TokenProviding) {
        self.baseURL = baseURL
        self.tokens = tokens
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30 // idle gap between bytes; server pings every 10 s
        config.timeoutIntervalForResource = 300
        config.waitsForConnectivity = false
        config.urlCache = nil
        session = URLSession(configuration: config)
        let short = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        clientVersion = "\(short) (\(build))"
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil, token: String) -> URLRequest {
        var req = URLRequest(url: baseURL.appending(path: path))
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("AxxiomSafety/\(clientVersion)", forHTTPHeaderField: "User-Agent")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return req
    }

    /// JSON request with one automatic token refresh on 401.
    func json<T: Decodable>(_ type: T.Type, path: String, method: String = "GET", payload: Data? = nil) async throws -> T {
        var token = try await tokens.accessToken()
        var (data, response) = try await session.data(for: request(path, method: method, body: payload, token: token))
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            token = try await tokens.forceRefresh()
            (data, response) = try await session.data(for: request(path, method: method, body: payload, token: token))
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if let failure = ChatFailure.from(status: status, retryAfter: nil) {
            if failure == .unauthorized { await tokens.sessionExpired() }
            throw failure
        }
        return try ChatEvent.decoder.decode(T.self, from: data)
    }

    /// Streams chat events. Fails before the first byte are retried once (safe: the request is idempotent by client_message_id).
    func chat(_ body: ChatRequest) -> AsyncThrowingStream<ChatEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var attempt = 0
                while true {
                    attempt += 1
                    var receivedBytes = false
                    do {
                        let token = try await tokens.accessToken()
                        var req = request("/v1/chat", method: "POST", body: try JSONEncoder().encode(body), token: token)
                        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                        let (bytes, response) = try await session.bytes(for: req)
                        let http = response as? HTTPURLResponse
                        let status = http?.statusCode ?? 0
                        if status == 401, attempt == 1 {
                            _ = try await tokens.forceRefresh()
                            continue
                        }
                        if let failure = ChatFailure.from(status: status, retryAfter: http?.value(forHTTPHeaderField: "Retry-After")) {
                            if failure == .unauthorized { await tokens.sessionExpired() }
                            throw failure
                        }
                        var parser = SSEParser()
                        for try await byte in bytes {
                            receivedBytes = true
                            if let e = parser.feed(byte) { continuation.yield(ChatEvent.decode(e)) }
                        }
                        continuation.finish()
                        return
                    } catch let error as ChatFailure {
                        continuation.finish(throwing: error)
                        return
                    } catch let error as URLError {
                        let failure = ChatFailure.from(urlError: error, receivedBytes: receivedBytes)
                        if failure == .offline, attempt == 1, !receivedBytes {
                            try? await Task.sleep(for: .seconds(1))
                            continue
                        }
                        continuation.finish(throwing: failure)
                        return
                    } catch {
                        if Task.isCancelled { continuation.finish(throwing: ChatFailure.cancelled); return }
                        continuation.finish(throwing: ChatFailure.unavailable(message: "The assistant hit an unexpected error. Use the manual in the app."))
                        return
                    }
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// Abstraction over the chat stream so the UI can be driven by a fixture in tests.
protocol ChatTransport: Sendable {
    func send(_ request: ChatRequest) -> AsyncThrowingStream<ChatEvent, Error>
}

extension APIClient: ChatTransport {
    func send(_ request: ChatRequest) -> AsyncThrowingStream<ChatEvent, Error> { chat(request) }
}
