import SwiftUI

/// Full-screen reader opened from a citation card (or a search hit): the cited page with the passage highlighted.
struct ManualReaderScreen: View {
    let destination: ManualDestination
    @Environment(ManualStore.self) private var manualStore
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var pageIndex: Int
    @State private var ranges: [NSRange] = []
    @State private var notFound = false
    @State private var showTOC = false
    @State private var goToPageText = ""

    init(destination: ManualDestination) {
        self.destination = destination
        _pageIndex = State(initialValue: destination.pageIndex)
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                if let document = manualStore.document {
                    PDFReaderView(document: document, pageIndex: pageIndex, highlightRanges: ranges)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    ContentUnavailableView("Manual not downloaded", systemImage: "book.closed", description: Text("Connect to the internet once to download the manual."))
                }
                EmergencyButton().padding(16)
            }
            .navigationTitle(destination.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .principal) {
                    Button { showTOC = true } label: {
                        Text("Page \(pageIndex) of \(manualStore.document?.pageCount ?? 0)").font(.subheadline.bold())
                    }
                    .accessibilityLabel("Page \(pageIndex). Open table of contents")
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button { pageIndex = max(1, pageIndex - 1); ranges = [] } label: { Image(systemName: "chevron.left") }.disabled(pageIndex <= 1)
                    Spacer()
                    if let title = manualStore.programTitle(forPage: pageIndex) { Text(title).font(.caption).lineLimit(1) }
                    Spacer()
                    Button { pageIndex = min(manualStore.document?.pageCount ?? pageIndex, pageIndex + 1); ranges = [] } label: { Image(systemName: "chevron.right") }
                }
            }
            .overlay(alignment: .top) {
                if notFound {
                    Text("Showing page \(pageIndex). The exact passage could not be highlighted.")
                        .font(.footnote).padding(8).background(.thinMaterial, in: Capsule()).padding(.top, 8)
                }
            }
            .sheet(isPresented: $showTOC) { tableOfContents }
            .task(id: destination.id) {
                guard let quote = destination.quote, !quote.isEmpty else { return }
                let found = await manualStore.index.locate(quote: quote, pageIndex: destination.pageIndex)
                ranges = found
                notFound = found.isEmpty
            }
        }
    }

    private var tableOfContents: some View {
        NavigationStack {
            List {
                Section("Go to page") {
                    HStack {
                        TextField("Page number", text: $goToPageText).keyboardType(.numberPad)
                        Button("Go") {
                            if let p = Int(goToPageText), p >= 1, p <= (manualStore.document?.pageCount ?? 0) {
                                pageIndex = p; ranges = []; showTOC = false
                            }
                        }
                    }
                }
                Section("Programs") {
                    ForEach(manualStore.programs) { p in
                        Button {
                            pageIndex = p.startPage; ranges = []; showTOC = false
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
            .navigationTitle("Contents")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { showTOC = false } } }
        }
    }
}
