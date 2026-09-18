import AVFoundation
import Foundation
import Observation

/// Reads an answer aloud with the system voice; one utterance at a time.
@MainActor
@Observable
final class ReadAloudService {
    private let synthesizer = AVSpeechSynthesizer()
    private(set) var speakingMessageId: UUID?

    func toggle(text: String, messageId: UUID) {
        if speakingMessageId == messageId {
            stop()
            return
        }
        stop()
        let plain = text
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "> ", with: "")
            .replacingOccurrences(of: "#", with: "")
        let utterance = AVSpeechUtterance(string: plain)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        speakingMessageId = messageId
        synthesizer.speak(utterance)
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
        speakingMessageId = nil
    }
}
