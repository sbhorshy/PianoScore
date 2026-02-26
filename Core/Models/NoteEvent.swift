import Foundation

enum NoteEventState: String {
    case correct
    case wrong
    case missed
}

struct NoteEvent: Identifiable {
    let id = UUID()
    let expected: Note
    let played: UInt8?
    let timestamp: Date

    var state: NoteEventState {
        if expected.isRest {
            return played == nil ? .correct : .wrong
        }

        guard let played else { return .missed }
        return played == expected.midiNote ? .correct : .wrong
    }
}
