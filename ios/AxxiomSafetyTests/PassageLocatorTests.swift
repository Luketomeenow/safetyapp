import Foundation
import Testing
@testable import AxxiomSafety

struct PassageLocatorTests {
    let pageText = "Locking and Tagging Circuits\nIf the energy source has a lockout point, always use locks over tags. Only when an energy source\ndoes not have a lockout point, should a tag be used as the Company does not believe that tags\nare as secure as locks. The wearer\u{2019}s movements. \u{25CF}\u{200B} Hydraulic cylinder leak"

    @Test func findsQuoteAcrossLineBreak() {
        let page = TextNormalizer.normalize(pageText)
        let ranges = PassageLocator.locate(quote: "Only when an energy source does not have a lockout point, should a tag be used", in: page)
        #expect(ranges.count == 1)
        let ns = NSString(string: pageText)
        #expect(ns.substring(with: ranges[0]).hasPrefix("Only when an energy source"))
        #expect(ns.substring(with: ranges[0]).hasSuffix("should a tag be used"))
    }

    @Test func foldsCurlyQuotesAndBullets() {
        let page = TextNormalizer.normalize(pageText)
        #expect(!PassageLocator.locate(quote: "The wearer's movements", in: page).isEmpty)
        #expect(!PassageLocator.locate(quote: "\u{25CF} Hydraulic cylinder leak", in: page).isEmpty)
    }

    @Test func fallsBackToSentencesThenNothing() {
        let page = TextNormalizer.normalize(pageText)
        let partial = PassageLocator.locate(quote: "always use locks over tags. This sentence is not on the page at all whatsoever.", in: page)
        #expect(!partial.isEmpty)
        #expect(PassageLocator.locate(quote: "completely unrelated words here", in: page).isEmpty)
    }
}
