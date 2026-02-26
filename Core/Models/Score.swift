import Foundation

struct Score: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let measures: [Measure]

    var allNotes: [Note] {
        measures.flatMap(\.notes)
    }
}
