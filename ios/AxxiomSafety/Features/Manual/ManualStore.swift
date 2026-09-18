import Foundation
import Observation
import PDFKit
import SwiftData

/// Downloads, verifies and versions the manual PDF; owns the PDFDocument and the text index.
@MainActor
@Observable
final class ManualStore {
    enum State: Equatable {
        case notDownloaded
        case downloading(Double)
        case ready(versionId: String, effectiveDate: String, pageCount: Int)
        case failed(String)
    }

    private(set) var state: State = .notDownloaded
    private(set) var document: PDFDocument?
    private(set) var programs: [ManualProgramDTO] = []
    private(set) var sections: [ManualSectionDTO] = []
    private(set) var updateBanner: String?
    let index = PageTextIndex()
    private let environment: AppEnvironment
    private var refreshing = false

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    var versionId: String? {
        if case .ready(let v, _, _) = state { return v }
        return nil
    }

    /// Opens the locally stored manual if any, then checks the API for a newer version.
    func refreshIfNeeded(session: SessionStore) async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        let context = PersistenceController.shared.container.mainContext
        let local = (try? context.fetch(FetchDescriptor<ManualVersionRecord>(sortBy: [SortDescriptor(\.downloadedAt, order: .reverse)])))?.first
        if let local, document == nil { await open(local) }
        do {
            let current = try await session.api.manualCurrent()
            if local?.versionId == current.versionId, local?.checksum == current.pdfSha256, document != nil { return }
            await download(current, context: context, previous: local)
        } catch {
            if document == nil { state = .failed("The manual could not be downloaded yet. Connect to the internet and try again.") }
        }
    }

    private func open(_ record: ManualVersionRecord) async {
        let url = ManualFiles.url(for: record.versionId)
        guard let doc = PDFDocument(url: url) else {
            state = .failed("The stored manual could not be opened.")
            return
        }
        document = doc
        programs = (try? JSONDecoder().decode([ManualProgramDTO].self, from: record.programsJSON)) ?? []
        sections = (try? JSONDecoder().decode([ManualSectionDTO].self, from: record.sectionsJSON)) ?? []
        state = .ready(versionId: record.versionId, effectiveDate: record.effectiveDate, pageCount: record.pageCount)
        await index.build(from: url)
    }

    private func download(_ current: ManualCurrentDTO, context: ModelContext, previous: ManualVersionRecord?) async {
        state = .downloading(0)
        do {
            let (temp, _) = try await URLSession.shared.download(from: current.pdfUrl)
            let sha = try ManualFiles.sha256(of: temp)
            guard sha == current.pdfSha256 else {
                try? FileManager.default.removeItem(at: temp)
                throw URLError(.cannotDecodeContentData)
            }
            let dest = ManualFiles.url(for: current.versionId)
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: temp, to: dest)
            let record = ManualVersionRecord(
                versionId: current.versionId, effectiveDate: current.effectiveDate, pageCount: current.pageCount, bodyStartPage: current.bodyStartPage,
                checksum: sha, fileName: dest.lastPathComponent,
                programsJSON: try JSONEncoder().encode(current.programs), sectionsJSON: try JSONEncoder().encode(current.sections)
            )
            if let previous { context.delete(previous) }
            context.insert(record)
            try context.save()
            ManualFiles.removeOthers(keeping: current.versionId)
            await open(record)
            if previous != nil, previous?.versionId != current.versionId {
                updateBanner = "Manual updated to \(current.versionId) (effective \(current.effectiveDate))"
            }
        } catch {
            if let previous {
                await open(previous)
            } else {
                state = .failed("The manual download failed. Check your connection and try again.")
            }
        }
    }

    func programTitle(forPage page: Int) -> String? {
        programs.first { $0.startPage <= page && $0.endPage >= page }.map { "Program \($0.number): \($0.title)" }
    }
}
