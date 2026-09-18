import AVFoundation
import Foundation
import Observation
import Speech

/// On-device dictation for the question box. Falls back to server recognition when the device lacks on-device support.
@MainActor
@Observable
final class DictationService {
    private(set) var isRecording = false
    private(set) var transcript = ""
    private(set) var errorMessage: String?
    var preferOnDevice = true

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en_US"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let engine = AVAudioEngine()
    private var silenceTimer: Task<Void, Never>?

    var isAvailable: Bool { recognizer?.isAvailable ?? false }

    func toggle() {
        if isRecording { stop() } else { Task { await start() } }
    }

    func start() async {
        errorMessage = nil
        let speechStatus = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        guard speechStatus == .authorized else {
            errorMessage = "Speech recognition is not allowed. Enable it in Settings."
            return
        }
        let micGranted = await AVAudioApplication.requestRecordPermission()
        guard micGranted else {
            errorMessage = "Microphone access is needed to dictate."
            return
        }
        guard let recognizer, recognizer.isAvailable else {
            errorMessage = "Dictation is not available right now."
            return
        }
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            if preferOnDevice, recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
            self.request = request
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
            engine.prepare()
            try engine.start()
            isRecording = true
            transcript = ""
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let result { self.transcript = result.bestTranscription.formattedString }
                    if error != nil || (result?.isFinal ?? false) { self.stop() }
                }
            }
            // On-device recognition can silently return nothing; stop after 3 s of no result.
            silenceTimer?.cancel()
            silenceTimer = Task { [weak self] in
                try? await Task.sleep(for: .seconds(3))
                guard let self, self.isRecording, self.transcript.isEmpty else { return }
                self.errorMessage = "No speech detected. Try again or type your question."
                self.stop()
            }
        } catch {
            errorMessage = "Could not start the microphone."
            stop()
        }
    }

    func stop() {
        silenceTimer?.cancel()
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
