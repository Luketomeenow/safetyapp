import Foundation
import SwiftData

@Model
final class Conversation {
    @Attribute(.unique) var id: String
    var title: String
    var createdAt: Date
    var updatedAt: Date
    @Relationship(deleteRule: .cascade, inverse: \Message.conversation) var messages: [Message] = []

    init(id: String, title: String, createdAt: Date = .now) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = createdAt
    }
}

@Model
final class Message {
    @Attribute(.unique) var id: UUID
    var serverId: String?
    var role: String // user | assistant
    var text: String
    var status: String // streaming | complete | interrupted | failed
    var kind: String? // answer | not_covered | ...
    var createdAt: Date
    var manualVersionId: String?
    var manualEffectiveDate: String?
    var feedbackRating: String?
    var feedbackFlagged: Bool
    var feedbackPending: Bool
    @Relationship(deleteRule: .cascade) var citations: [Citation] = []
    var conversation: Conversation?

    init(id: UUID = UUID(), role: String, text: String, status: String, createdAt: Date = .now) {
        self.id = id
        self.role = role
        self.text = text
        self.status = status
        self.createdAt = createdAt
        self.feedbackFlagged = false
        self.feedbackPending = false
    }
}

@Model
final class Citation {
    var citationId: String
    var order: Int
    var pageIndex: Int
    var programNumber: Int?
    var programTitle: String?
    var sectionNumber: String?
    var sectionTitle: String?
    var quote: String?

    init(dto: CitationDTO, order: Int) {
        citationId = dto.id
        self.order = order
        pageIndex = dto.page
        programNumber = dto.program?.number
        programTitle = dto.program?.title
        sectionNumber = dto.section?.number
        sectionTitle = dto.section?.title
        quote = dto.quote
    }

    var dto: CitationDTO {
        CitationDTO(
            id: citationId,
            page: pageIndex,
            program: programNumber.map { ProgramRef(number: $0, title: programTitle ?? "") },
            section: sectionTitle.map { SectionRef(number: sectionNumber, title: $0) },
            quote: quote
        )
    }
}

@Model
final class ManualVersionRecord {
    @Attribute(.unique) var versionId: String
    var effectiveDate: String
    var pageCount: Int
    var bodyStartPage: Int
    var checksum: String
    var fileName: String
    var downloadedAt: Date
    var programsJSON: Data
    var sectionsJSON: Data

    init(versionId: String, effectiveDate: String, pageCount: Int, bodyStartPage: Int, checksum: String, fileName: String, programsJSON: Data, sectionsJSON: Data) {
        self.versionId = versionId
        self.effectiveDate = effectiveDate
        self.pageCount = pageCount
        self.bodyStartPage = bodyStartPage
        self.checksum = checksum
        self.fileName = fileName
        self.downloadedAt = .now
        self.programsJSON = programsJSON
        self.sectionsJSON = sectionsJSON
    }
}
