import Testing
@testable import AxxiomSafety

struct SSEParserTests {
    @Test func parsesEventsWithMultiLineDataAndComments() {
        var parser = SSEParser()
        let input = ": ping\nevent: text\ndata: {\"delta\":\"a\"}\ndata: {\"more\":1}\n\nevent: done\r\ndata: {}\r\n\r\n"
        let events = parser.feed(Array(input.utf8))
        #expect(events.count == 2)
        #expect(events[0].event == "text")
        #expect(events[0].data == "{\"delta\":\"a\"}\n{\"more\":1}")
        #expect(events[1].event == "done")
    }

    @Test func keepsUnicodeLineSeparatorsInsideJSON() {
        var parser = SSEParser()
        let json = "{\"delta\":\"line\u{2028}break\"}"
        let events = parser.feed(Array("event: text\ndata: \(json)\n\n".utf8))
        #expect(events.count == 1)
        #expect(events[0].data == json)
    }

    @Test func doesNotDispatchWithoutData() {
        var parser = SSEParser()
        #expect(parser.feed(Array("event: status\n\n".utf8)).isEmpty)
    }

    @Test func handlesBytesSplitAcrossChunks() {
        var parser = SSEParser()
        let whole = Array("event: text\ndata: {\"delta\":\"héllo\"}\n\n".utf8)
        var events: [SSEEvent] = []
        for b in whole { if let e = parser.feed(b) { events.append(e) } }
        #expect(events.count == 1)
        #expect(events[0].data.contains("héllo"))
    }
}
