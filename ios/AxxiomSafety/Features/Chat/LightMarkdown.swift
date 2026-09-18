import Foundation
import SwiftUI

/// The small Markdown subset the API produces: bold headings, paragraphs, bullets, numbered lists, blockquotes.
enum LightMarkdownBlock: Equatable, Identifiable {
    case heading(String)
    case paragraph(String)
    case bullets([String])
    case numbered([String])
    case quote(String)

    var id: String {
        switch self {
        case .heading(let t): return "h:\(t)"
        case .paragraph(let t): return "p:\(t)"
        case .bullets(let items): return "b:\(items.joined(separator: "|"))"
        case .numbered(let items): return "n:\(items.joined(separator: "|"))"
        case .quote(let t): return "q:\(t)"
        }
    }
}

enum LightMarkdown {
    static func parse(_ text: String) -> [LightMarkdownBlock] {
        var blocks: [LightMarkdownBlock] = []
        var paragraph: [String] = []
        var bullets: [String] = []
        var numbered: [String] = []
        var quote: [String] = []

        func flushParagraph() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: " "))); paragraph = [] }
        }
        func flushLists() {
            if !bullets.isEmpty { blocks.append(.bullets(bullets)); bullets = [] }
            if !numbered.isEmpty { blocks.append(.numbered(numbered)); numbered = [] }
        }
        func flushQuote() {
            if !quote.isEmpty { blocks.append(.quote(quote.joined(separator: " "))); quote = [] }
        }
        func flushAll() { flushParagraph(); flushLists(); flushQuote() }

        for raw in text.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { flushAll(); continue }
            if line.hasPrefix("> ") || line == ">" {
                flushParagraph(); flushLists()
                quote.append(String(line.dropFirst(line == ">" ? 1 : 2)))
                continue
            }
            flushQuote()
            if line.hasPrefix("**"), line.hasSuffix("**"), line.count > 4 {
                flushAll()
                blocks.append(.heading(String(line.dropFirst(2).dropLast(2))))
                continue
            }
            if line.hasPrefix("#") {
                flushAll()
                blocks.append(.heading(line.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)))
                continue
            }
            if line.hasPrefix("- ") || line.hasPrefix("• ") || line.hasPrefix("* ") {
                flushParagraph(); if !numbered.isEmpty { blocks.append(.numbered(numbered)); numbered = [] }
                bullets.append(String(line.dropFirst(2)))
                continue
            }
            if let range = line.range(of: #"^\d+[.)]\s+"#, options: .regularExpression) {
                flushParagraph(); if !bullets.isEmpty { blocks.append(.bullets(bullets)); bullets = [] }
                numbered.append(String(line[range.upperBound...]))
                continue
            }
            flushLists()
            paragraph.append(line)
        }
        flushAll()
        return blocks
    }

    /// Inline Markdown (bold, italics) via AttributedString; falls back to plain text.
    static func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }
}

struct LightMarkdownView: View {
    let blocks: [LightMarkdownBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(blocks) { block in
                switch block {
                case .heading(let t):
                    Text(t).font(.headline).padding(.top, 4)
                case .paragraph(let t):
                    Text(LightMarkdown.inline(t)).font(.body)
                case .bullets(let items):
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("•")
                                Text(LightMarkdown.inline(item))
                            }
                        }
                    }
                case .numbered(let items):
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("\(i + 1).").monospacedDigit()
                                Text(LightMarkdown.inline(item))
                            }
                        }
                    }
                case .quote(let t):
                    HStack(alignment: .top, spacing: 8) {
                        RoundedRectangle(cornerRadius: 2).fill(Color.accentColor).frame(width: 3)
                        Text(LightMarkdown.inline(t)).font(.callout).italic().foregroundStyle(.secondary)
                    }
                }
            }
        }
        .textSelection(.enabled)
    }
}
