import SwiftUI

/// The Manual tab: status, search (works offline), and the program list.
struct ManualScreen: View {
    @Environment(ManualStore.self) private var manualStore
    @Environment(SessionStore.self) private var session
    @Environment(AppRouter.self) private var router
    @State private var query = ""
    @State private var hits: [PageTextIndex.Hit] = []
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                if let banner = manualStore.updateBanner {
                    Label(banner, systemImage: "arrow.down.doc").font(.footnote)
                }
                switch manualStore.state {
                case .notDownloaded:
                    Text("Downloading the manual the first time needs an internet connection.")
                case .downloading(let progress):
                    ProgressView(value: progress) { Text("Downloading the manual…") }
                case .failed(let message):
                    Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    Button("Try again") { Task { await manualStore.refreshIfNeeded(session: session) } }
                case .ready(let version, let date, let pages):
                    Text("\(version) · effective \(date) · \(pages) pages").font(.footnote).foregroundStyle(.secondary)
                }
                if !query.isEmpty {
                    Section("Results (\(hits.count))") {
                        if hits.isEmpty { Text("No matches").foregroundStyle(.secondary) }
                        ForEach(hits) { hit in
                            Button {
                                router.manualDestination = ManualDestination(pageIndex: hit.pageIndex, quote: query, label: manualStore.programTitle(forPage: hit.pageIndex) ?? "Page \(hit.pageIndex)")
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(manualStore.programTitle(forPage: hit.pageIndex) ?? "") · page \(hit.pageIndex)").font(.caption).foregroundStyle(.secondary)
                                    Text(hit.snippet).font(.subheadline).lineLimit(3)
                                }
                            }
                            .frame(minHeight: 44)
                        }
                    }
                } else {
                    Section("Programs") {
                        ForEach(manualStore.programs) { p in
                            Button {
                                router.manualDestination = ManualDestination(pageIndex: p.startPage, quote: nil, label: "Program \(p.number): \(p.title)")
                            } label: {
                                HStack {
                                    Text("\(p.number)").monospacedDigit().foregroundStyle(.secondary).frame(width: 28, alignment: .trailing)
                                    Text(p.title)
                                    Spacer()
                                    Text("p. \(p.startPage)").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .frame(minHeight: 44)
                        }
                    }
                }
            }
            .navigationTitle("Manual")
            .searchable(text: $query, prompt: "Search the manual (works offline)")
            .onChange(of: query) { _, q in
                searchTask?.cancel()
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(300))
                    guard !Task.isCancelled else { return }
                    hits = q.count >= 3 ? await manualStore.index.search(q) : []
                }
            }
        }
    }
}
