import Foundation
import Combine

final class PracticeSession: ObservableObject {
    @Published private(set) var events: [NoteEvent] = []

    private let scoreEngine: ScoreEngine
    private let comparisonEngine = ComparisonEngine()

    init(score: Score) {
        self.scoreEngine = ScoreEngine(score: score)
    }

    var currentNote: Note? {
        scoreEngine.currentNote
    }

    func submit(played note: UInt8?) {
        guard let expected = scoreEngine.currentNote else { return }
        let event = comparisonEngine.compare(expected: expected, played: note)
        events.append(event)
        scoreEngine.advance()
    }

    func restart() {
        events.removeAll()
        scoreEngine.reset()
    }
}
