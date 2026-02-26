import XCTest
@testable import PianoScoreCore

final class PianoScoreCoreTests: XCTestCase {
    func testNoteEventStateCorrect() {
        let note = Note(pitch: 60, duration: 1, isRest: false)
        let event = NoteEvent(expected: note, played: 60, timestamp: Date())
        XCTAssertEqual(event.state, .correct)
    }

    func testNoteEventStateWrong() {
        let note = Note(pitch: 60, duration: 1, isRest: false)
        let event = NoteEvent(expected: note, played: 61, timestamp: Date())
        XCTAssertEqual(event.state, .wrong)
    }

    func testNoteEventStateMissed() {
        let note = Note(pitch: 60, duration: 1, isRest: false)
        let event = NoteEvent(expected: note, played: nil, timestamp: Date())
        XCTAssertEqual(event.state, .missed)
    }

    func testScoreEngineProgressionAndReset() {
        let score = Score(
            title: "Test",
            measures: [
                Measure(number: 1, notes: [
                    Note(pitch: 60, duration: 1, isRest: false),
                    Note(pitch: 62, duration: 1, isRest: false)
                ])
            ]
        )

        let engine = ScoreEngine(score: score)
        XCTAssertEqual(engine.currentNote?.midiNote, 60)

        engine.advance()
        XCTAssertEqual(engine.currentNote?.midiNote, 62)

        engine.advance()
        XCTAssertNil(engine.currentNote)

        engine.reset()
        XCTAssertEqual(engine.currentNote?.midiNote, 60)
    }

    func testScoreLoaderDemoAndMusicXMLFallback() throws {
        let loader = ScoreLoader()

        let demos = loader.loadDemoScores()
        XCTAssertFalse(demos.isEmpty)
        XCTAssertEqual(demos.first?.title, "C Major Warmup")

        let parsed = try loader.loadMusicXML(from: Data("<score-partwise/>".utf8))
        XCTAssertEqual(parsed.title, "Demo Score")
        XCTAssertEqual(parsed.allNotes.count, 4)
    }
}
