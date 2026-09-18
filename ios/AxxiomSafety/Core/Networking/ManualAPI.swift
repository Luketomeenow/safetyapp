import Foundation

struct ManualProgramDTO: Codable, Sendable, Equatable, Identifiable {
    var id: Int { number }
    let number: Int
    let title: String
    let startPage: Int
    let endPage: Int
}

struct ManualSectionDTO: Codable, Sendable, Equatable {
    let number: String
    let title: String
    let startPage: Int
}

struct ManualCurrentDTO: Codable, Sendable, Equatable {
    let versionId: String
    let effectiveDate: String
    let pageCount: Int
    let bodyStartPage: Int
    let pdfSha256: String
    let pagesSha256: String
    let sizeBytes: Int
    let pdfUrl: URL
    let programs: [ManualProgramDTO]
    let sections: [ManualSectionDTO]
}

struct ConfigDTO: Codable, Sendable, Equatable {
    struct Contact: Codable, Sendable, Equatable { let label: String; let tel: String; let note: String? }
    let emergencyContacts: [Contact]
    let disclaimerVersion: String
    let minAppVersion: String
}

struct FeedbackRequest: Encodable, Sendable {
    let messageId: String
    var rating: String?
    var flag: String?
    var comment: String?

    enum CodingKeys: String, CodingKey {
        case messageId = "message_id"
        case rating, flag, comment
    }
}

struct FeedbackResponse: Decodable, Sendable { let id: String }

extension APIClient {
    func manualCurrent() async throws -> ManualCurrentDTO { try await json(ManualCurrentDTO.self, path: "/v1/manual/current") }
    func config() async throws -> ConfigDTO { try await json(ConfigDTO.self, path: "/v1/config") }
    func sendFeedback(_ request: FeedbackRequest) async throws -> FeedbackResponse {
        try await json(FeedbackResponse.self, path: "/v1/feedback", method: "POST", body: request)
    }
}
