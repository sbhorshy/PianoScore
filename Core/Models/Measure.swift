import Foundation

struct Measure: Identifiable, Hashable {
    let id = UUID()
    let number: Int
    let notes: [Note]
}
