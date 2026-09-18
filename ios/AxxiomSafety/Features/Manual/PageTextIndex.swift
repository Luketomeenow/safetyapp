import Foundation
import PDFKit

/// Normalized per-page text with an offset map back to the PDF's own string, so search and
/// citation highlighting survive line breaks, curly quotes, bullets and zero-width characters.
actor PageTextIndex {
    struct Page {
        let normalized: String
        /// normalized UTF-16 offset -> original UTF-16 offset
        let offsetMap: [Int]
        let originalLength: Int
    }

    private(set) var pages: [Page] = []
    private var document: PDFDocument?

    func build(from url: URL) {
        guard let doc = PDFDocument(url: url) else { return }
        document = doc
        var built: [Page] = []
        for i in 0 ..< doc.pageCount {
            let text = doc.page(at: i)?.string ?? ""
            built.append(TextNormalizer.normalize(text))
        }
        pages = built
    }

    var pageCount: Int { pages.count }

    /// Character ranges (in the PDF page's own string) where the quote appears on the 1-based page.
    func locate(quote: String, pageIndex: Int) -> [NSRange] {
        guard pageIndex >= 1, pageIndex <= pages.count, let page = pages[safe: pageIndex - 1] else { return [] }
        return PassageLocator.locate(quote: quote, in: page)
    }

    struct Hit: Identifiable, Sendable {
        var id: String { "\(pageIndex)-\(range.location)" }
        let pageIndex: Int
        let range: NSRange
        let snippet: String
    }

    /// Case-insensitive search across all pages; returns up to `limit` hits with a short snippet.
    func search(_ query: String, limit: Int = 200) -> [Hit] {
        let q = TextNormalizer.normalize(query).normalized
        guard q.count >= 3 else { return [] }
        var hits: [Hit] = []
        for (i, page) in pages.enumerated() {
            var searchRange = page.normalized.startIndex ..< page.normalized.endIndex
            while let r = page.normalized.range(of: q, range: searchRange) {
                let start = page.normalized.distance(from: page.normalized.startIndex, to: r.lowerBound)
                let end = page.normalized.distance(from: page.normalized.startIndex, to: r.upperBound)
                if let ns = PassageLocator.originalRange(normalizedStart: start, normalizedEnd: end, page: page) {
                    let snippetStart = max(0, start - 60)
                    let snippetEnd = min(page.normalized.count, end + 60)
                    let s = page.normalized.index(page.normalized.startIndex, offsetBy: snippetStart)
                    let e = page.normalized.index(page.normalized.startIndex, offsetBy: snippetEnd)
                    hits.append(Hit(pageIndex: i + 1, range: ns, snippet: "…" + String(page.normalized[s ..< e]) + "…"))
                    if hits.count >= limit { return hits }
                }
                searchRange = r.upperBound ..< page.normalized.endIndex
            }
        }
        return hits
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

enum TextNormalizer {
    /// Lowercases, folds curly quotes and dashes, drops zero-width characters, collapses whitespace,
    /// and records where each normalized character came from in the original string.
    static func normalize(_ original: String) -> PageTextIndex.Page {
        let utf16 = Array(original.utf16)
        var out: [UInt16] = []
        var map: [Int] = []
        var lastWasSpace = true
        var i = 0
        while i < utf16.count {
            let unit = utf16[i]
            let scalar = UnicodeScalar(unit)
            var mapped: [UInt16]
            switch unit {
            case 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF: mapped = []
            case 0x2018, 0x2019, 0x201A, 0x201B, 0x2032: mapped = [0x27] // '
            case 0x201C, 0x201D, 0x201E, 0x201F, 0x2033: mapped = [0x22] // "
            case 0x2010 ... 0x2015, 0x2212: mapped = [0x2D] // -
            case 0x00A0: mapped = [0x20]
            default:
                if let s = scalar, CharacterSet.whitespacesAndNewlines.contains(s) {
                    mapped = [0x20]
                } else if let s = scalar {
                    mapped = Array(String(Character(s)).lowercased().utf16)
                } else {
                    mapped = [unit] // surrogate half: keep as is
                }
            }
            for m in mapped {
                if m == 0x20 {
                    if lastWasSpace { continue }
                    lastWasSpace = true
                } else {
                    lastWasSpace = false
                }
                out.append(m)
                map.append(i)
            }
            i += 1
        }
        while out.last == 0x20 { out.removeLast(); map.removeLast() }
        return PageTextIndex.Page(normalized: String(utf16CodeUnits: out, count: out.count), offsetMap: map, originalLength: utf16.count)
    }
}
