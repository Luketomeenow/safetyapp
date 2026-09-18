import PDFKit
import SwiftUI

/// PDFKit view that shows one page and highlights the located passage ranges.
struct PDFReaderView: UIViewRepresentable {
    let document: PDFDocument
    let pageIndex: Int
    let highlightRanges: [NSRange]

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.document = document
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.autoScales = true
        view.pageShadowsEnabled = false
        view.minScaleFactor = view.scaleFactorForSizeToFit
        view.maxScaleFactor = 4
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        guard let page = document.page(at: max(0, pageIndex - 1)) else { return }
        let selections = highlightRanges.compactMap { page.selection(for: $0) }
        for s in selections { s.color = UIColor.systemYellow.withAlphaComponent(0.45) }
        view.highlightedSelections = selections.isEmpty ? nil : selections
        if context.coordinator.lastPage != pageIndex || context.coordinator.lastRanges != highlightRanges {
            context.coordinator.lastPage = pageIndex
            context.coordinator.lastRanges = highlightRanges
            DispatchQueue.main.async {
                view.go(to: page)
                if let first = selections.first { view.go(to: first) }
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var lastPage = -1
        var lastRanges: [NSRange] = []
    }
}
