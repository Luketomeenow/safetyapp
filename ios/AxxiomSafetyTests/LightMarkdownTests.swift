import Testing
@testable import AxxiomSafety

struct LightMarkdownTests {
    @Test func parsesHeadingsQuotesAndLists() {
        let text = "**Answer**\nNo.\n\n**Policy text**\n> Wood ladders are prohibited on the job.\n> Second line\nSource: Program 6, 6.5, page 42.\n**Conditions and stop points**\n- One\n- Two\n1. First\n2. Second"
        let blocks = LightMarkdown.parse(text)
        #expect(blocks[0] == .heading("Answer"))
        #expect(blocks[1] == .paragraph("No."))
        #expect(blocks[2] == .heading("Policy text"))
        #expect(blocks[3] == .quote("Wood ladders are prohibited on the job. Second line"))
        #expect(blocks[4] == .paragraph("Source: Program 6, 6.5, page 42."))
        #expect(blocks[6] == .bullets(["One", "Two"]))
        #expect(blocks[7] == .numbered(["First", "Second"]))
    }
}
