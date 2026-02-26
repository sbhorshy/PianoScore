import Foundation

final class ScoreEngine {
    private(set) var score: Score
    private(set) var currentNoteIndex: Int = 0

    init(score: Score) {
        self.score = score
    }

    var currentNote: Note? {
        guard currentNoteIndex < score.allNotes.count else { return nil }
        return score.allNotes[currentNoteIndex]
    }

    func advance() {
        currentNoteIndex = min(currentNoteIndex + 1, score.allNotes.count)
    }

    func reset() {
        currentNoteIndex = 0
    }
}
