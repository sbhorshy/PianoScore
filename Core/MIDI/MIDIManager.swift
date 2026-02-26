import Foundation
import Combine

final class MIDIManager: ObservableObject {
    @Published private(set) var activeNotes: Set<UInt8> = []

    func noteOn(_ note: UInt8) {
        activeNotes.insert(note)
    }

    func noteOff(_ note: UInt8) {
        activeNotes.remove(note)
    }
}
