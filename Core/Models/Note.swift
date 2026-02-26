import Foundation

struct Note: Identifiable, Hashable {
    let id = UUID()
    let pitch: Int
    let duration: Double
    let isRest: Bool

    var midiNote: UInt8 {
        UInt8(clamping: pitch)
    }
}
