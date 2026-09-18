import Testing
@testable import AxxiomSafety

struct ChatEventDecodingTests {
    @Test func decodesDoneWithSnakeCaseAndIgnoresUnknownFields() {
        let data = """
        {"message_id":"m1","conversation_id":"c1","client_message_id":"x","kind":"answer","stop_reason":"end_turn","truncated":false,
         "validation":{"passed":true,"problems":[],"quotes_verified":true},
         "citations":[{"id":"c1","page":56,"program":{"number":8,"title":"Lockout/Tagout/Tryout Program"},"section":{"number":"8.4","title":"Locking and Tagging Circuits"},"quote":"always use locks over tags","extra":1}],
         "manual":{"version_id":"axxiom-s2-v1.0","effective_date":"2026-09-16"},
         "usage":{"input_tokens":1,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":0},
         "timing":{"ttft_ms":1200,"total_ms":9000},"new_field":"ignored"}
        """
        guard case .done(let d) = ChatEvent.decode(SSEEvent(event: "done", data: data)) else { Issue.record("expected done"); return }
        #expect(d.kind == "answer")
        #expect(d.citations.first?.label == "Program 8 (Lockout/Tagout/Tryout Program) · 8.4 Locking and Tagging Circuits · Page 56")
        #expect(d.manual.versionId == "axxiom-s2-v1.0")
        #expect(d.timing.ttftMs == 1200)
    }

    @Test func unknownEventTypeIsTolerated() {
        #expect(ChatEvent.decode(SSEEvent(event: "future", data: "{}")) == .unknown("future"))
    }

    @Test func textDeltaDecodes() {
        #expect(ChatEvent.decode(SSEEvent(event: "text", data: "{\"delta\":\"hi\"}")) == .text("hi"))
    }
}
