// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PianoScore",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .library(name: "PianoScoreCore", targets: ["PianoScoreCore"])
    ],
    targets: [
        .target(
            name: "PianoScoreCore",
            path: ".",
            exclude: [
                "App",
                "Features",
                "DesignSystem",
                "Core/MIDI",
                "Core/Services/PracticeSession.swift",
                "README.md",
                "Tests"
            ],
            sources: [
                "Core/Models/Note.swift",
                "Core/Models/Measure.swift",
                "Core/Models/Score.swift",
                "Core/Models/NoteEvent.swift",
                "Core/Engine/ScoreEngine.swift",
                "Core/Engine/ComparisonEngine.swift",
                "Core/Parsers/MusicXMLParser.swift",
                "Core/Services/ScoreLoader.swift"
            ]
        ),
        .testTarget(
            name: "PianoScoreCoreTests",
            dependencies: ["PianoScoreCore"],
            path: "Tests/PianoScoreCoreTests"
        )
    ]
)
