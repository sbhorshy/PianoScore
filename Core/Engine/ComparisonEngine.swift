import Foundation

final class ComparisonEngine {
    func compare(expected: Note, played: UInt8?) -> NoteEvent {
        NoteEvent(expected: expected, played: played, timestamp: Date())
    }
}
