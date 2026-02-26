import Foundation

final class MusicXMLParser {
    func parse(data: Data) throws -> Score {
        // MVP: provide a fallback score until full XML parsing is implemented.
        let demo = Score(
            title: "Demo Score",
            measures: [
                Measure(number: 1, notes: [
                    Note(pitch: 60, duration: 1, isRest: false),
                    Note(pitch: 62, duration: 1, isRest: false),
                    Note(pitch: 64, duration: 1, isRest: false),
                    Note(pitch: 65, duration: 1, isRest: false)
                ])
            ]
        )
        return demo
    }
}
