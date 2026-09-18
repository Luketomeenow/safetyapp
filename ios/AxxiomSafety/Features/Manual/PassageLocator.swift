import Foundation

/// Finds a cited passage on a page, tolerating line breaks and punctuation differences.
enum PassageLocator {
    static func locate(quote: String, in page: PageTextIndex.Page) -> [NSRange] {
        var q = TextNormalizer.normalize(quote).normalized
        q = q.trimmingCharacters(in: CharacterSet(charactersIn: "•●○▪■-* \""))
        guard q.count >= 3 else { return [] }
        if let r = range(of: q, in: page) { return [r] } // 1. exact
        let sentences = q.split(whereSeparator: { ".;".contains($0) }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { $0.count >= 25 }
        let found = sentences.compactMap { range(of: $0, in: page) }
        if !found.isEmpty { return found } // 2. per sentence
        let words = q.split(separator: " ")
        if words.count >= 8, let r = range(of: words.prefix(8).joined(separator: " "), in: page) { return [r] } // 3. first eight words
        return [] // 4. page only
    }

    static func range(of needle: String, in page: PageTextIndex.Page) -> NSRange? {
        guard let r = page.normalized.range(of: needle) else { return nil }
        let start = page.normalized.distance(from: page.normalized.startIndex, to: r.lowerBound)
        let end = page.normalized.distance(from: page.normalized.startIndex, to: r.upperBound)
        return originalRange(normalizedStart: start, normalizedEnd: end, page: page)
    }

    /// Maps a normalized [start, end) span (in UTF-16 units of the normalized string) back to the original string.
    static func originalRange(normalizedStart: Int, normalizedEnd: Int, page: PageTextIndex.Page) -> NSRange? {
        guard normalizedStart >= 0, normalizedEnd > normalizedStart, normalizedEnd <= page.offsetMap.count else { return nil }
        let originalStart = page.offsetMap[normalizedStart]
        let originalEnd = page.offsetMap[normalizedEnd - 1] + 1
        guard originalEnd <= page.originalLength else { return nil }
        return NSRange(location: originalStart, length: originalEnd - originalStart)
    }
}
