import Foundation

/// One server-sent event as delivered by the API.
struct SSEEvent: Sendable, Equatable {
    var event: String = "message"
    var data: String = ""
    var id: String?
}

/// Byte-level SSE parser. Splits on LF only (never on U+2028/U+2029, which are legal inside JSON strings).
struct SSEParser: Sendable {
    private var line: [UInt8] = []
    private var eventName: String?
    private var dataLines: [String] = []
    private var lastID: String?

    /// Feed one byte; returns a completed event when a blank line dispatches one.
    mutating func feed(_ byte: UInt8) -> SSEEvent? {
        guard byte == 0x0A else {
            line.append(byte)
            return nil
        }
        if line.last == 0x0D { line.removeLast() } // tolerate CRLF
        let text = String(decoding: line, as: UTF8.self)
        line.removeAll(keepingCapacity: true)
        return consume(text)
    }

    /// Feed a chunk of bytes; returns every event completed within it.
    mutating func feed<S: Sequence>(_ bytes: S) -> [SSEEvent] where S.Element == UInt8 {
        var out: [SSEEvent] = []
        for b in bytes {
            if let e = feed(b) { out.append(e) }
        }
        return out
    }

    private mutating func consume(_ text: String) -> SSEEvent? {
        if text.isEmpty { return flush() }
        if text.hasPrefix(":") { return nil } // heartbeat comment
        let colon = text.firstIndex(of: ":") ?? text.endIndex
        var value = text[colon...].dropFirst()
        if value.first == " " { value = value.dropFirst() }
        switch text[..<colon] {
        case "event": eventName = String(value)
        case "data": dataLines.append(String(value))
        case "id": lastID = String(value)
        default: break
        }
        return nil
    }

    private mutating func flush() -> SSEEvent? {
        defer {
            eventName = nil
            dataLines.removeAll()
        }
        guard !dataLines.isEmpty else { return nil }
        return SSEEvent(event: eventName ?? "message", data: dataLines.joined(separator: "\n"), id: lastID)
    }
}
