import Foundation

/// Wire shapes of the API's SSE events (snake_case JSON, decoded with .convertFromSnakeCase).
enum ChatEvent: Sendable, Equatable {
    case status(StatusDTO)
    case text(String)
    case citation(CitationDTO)
    case emergency(EmergencyDTO)
    case replace(ReplaceDTO)
    case done(DoneDTO)
    case error(APIErrorDTO)
    case unknown(String)

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    static func decode(_ e: SSEEvent) -> ChatEvent {
        let data = Data(e.data.utf8)
        func parse<T: Decodable>(_ type: T.Type) -> T? { try? decoder.decode(type, from: data) }
        switch e.event {
        case "status": return parse(StatusDTO.self).map(ChatEvent.status) ?? .unknown(e.event)
        case "text": return parse(TextDTO.self).map { .text($0.delta) } ?? .unknown(e.event)
        case "citation": return parse(CitationDTO.self).map(ChatEvent.citation) ?? .unknown(e.event)
        case "emergency": return parse(EmergencyDTO.self).map(ChatEvent.emergency) ?? .unknown(e.event)
        case "replace": return parse(ReplaceDTO.self).map(ChatEvent.replace) ?? .unknown(e.event)
        case "done": return parse(DoneDTO.self).map(ChatEvent.done) ?? .unknown(e.event)
        case "error": return parse(APIErrorDTO.self).map(ChatEvent.error) ?? .unknown(e.event)
        default: return .unknown(e.event)
        }
    }
}

struct StatusDTO: Codable, Sendable, Equatable {
    let stage: String // reading_manual | writing | verifying
}

struct TextDTO: Codable, Sendable, Equatable { let delta: String }

struct ProgramRef: Codable, Sendable, Equatable, Hashable {
    let number: Int
    let title: String
}

struct SectionRef: Codable, Sendable, Equatable, Hashable {
    let number: String?
    let title: String
}

struct CitationDTO: Codable, Sendable, Equatable, Identifiable, Hashable {
    let id: String
    let page: Int
    let program: ProgramRef?
    let section: SectionRef?
    let quote: String?

    var label: String {
        var parts: [String] = []
        if let p = program { parts.append("Program \(p.number) (\(p.title))") }
        if let s = section, let n = s.number { parts.append("\(n) \(s.title)") }
        parts.append("Page \(page)")
        return parts.joined(separator: " · ")
    }

    var accessibilityLabel: String {
        var text = "Open "
        if let p = program { text += "Program \(p.number), \(p.title), " }
        if let s = section, let n = s.number { text += "section \(n), " }
        text += "page \(page) in the manual"
        return text
    }
}

struct EmergencyDTO: Codable, Sendable, Equatable {
    struct Call: Codable, Sendable, Equatable { let label: String; let tel: String }
    struct Contact: Codable, Sendable, Equatable { let label: String; let tel: String }
    struct CitationRef: Codable, Sendable, Equatable { let page: Int; let section: String }
    let headline: String
    let steps: [String]
    let call: Call
    let contacts: [Contact]
    let citations: [CitationRef]
}

struct ReplaceDTO: Codable, Sendable, Equatable {
    let text: String
    let reason: String
}

struct UsageDTO: Codable, Sendable, Equatable {
    let inputTokens: Int
    let outputTokens: Int
    let cacheReadInputTokens: Int
    let cacheCreationInputTokens: Int
}

struct ValidationDTO: Codable, Sendable, Equatable {
    let passed: Bool
    let problems: [String]
    let quotesVerified: Bool
}

struct ManualRefDTO: Codable, Sendable, Equatable {
    let versionId: String
    let effectiveDate: String
}

struct TimingDTO: Codable, Sendable, Equatable {
    let ttftMs: Int?
    let totalMs: Int
}

struct DoneDTO: Codable, Sendable, Equatable {
    let messageId: String
    let conversationId: String
    let clientMessageId: String?
    let kind: String // answer | not_covered | out_of_scope | emergency | refusal | validation_failed | error
    let stopReason: String?
    let truncated: Bool
    let validation: ValidationDTO
    let citations: [CitationDTO]
    let manual: ManualRefDTO
    let usage: UsageDTO
    let timing: TimingDTO

    var isEmergency: Bool { kind == "emergency" }
    var isNotCovered: Bool { kind == "not_covered" || kind == "out_of_scope" }
}

struct APIErrorDTO: Codable, Sendable, Equatable {
    let code: String
    let message: String
    let retryable: Bool?
}

struct ChatRequest: Encodable, Sendable {
    var conversationId: String?
    let clientMessageId: String
    let message: String
    var deviceId: String?
    var clientVersion: String?

    enum CodingKeys: String, CodingKey {
        case conversationId = "conversation_id"
        case clientMessageId = "client_message_id"
        case message
        case deviceId = "device_id"
        case clientVersion = "client_version"
    }
}
