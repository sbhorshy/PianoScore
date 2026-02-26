import Foundation

final class ScoreLoader {
    private let parser = MusicXMLParser()

    func loadDemoScores() -> [Score] {
        [
            Score(title: "C Major Warmup", measures: [
                Measure(number: 1, notes: [
                    Note(pitch: 60, duration: 1, isRest: false),
                    Note(pitch: 62, duration: 1, isRest: false),
                    Note(pitch: 64, duration: 1, isRest: false),
                    Note(pitch: 65, duration: 1, isRest: false)
                ])
            ])
        ]
    }

    func loadMusicXML(from data: Data) throws -> Score {
        try parser.parse(data: data)
    }
}
