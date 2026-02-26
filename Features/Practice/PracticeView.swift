import SwiftUI

struct PracticeView: View {
    @StateObject private var session: PracticeSession

    init(score: Score) {
        _session = StateObject(wrappedValue: PracticeSession(score: score))
    }

    var body: some View {
        VStack(spacing: 20) {
            if let current = session.currentNote {
                Text("Expected MIDI: \(current.midiNote)")
                    .font(.title3)
            } else {
                Text("Completed!")
                    .font(.title)
                    .foregroundColor(Theme.success)
            }

            HStack {
                Button("Correct") {
                    guard let note = session.currentNote else { return }
                    session.submit(played: note.midiNote)
                }
                .buttonStyle(.borderedProminent)

                Button("Wrong") {
                    session.submit(played: 0)
                }
                .tint(Theme.error)
                .buttonStyle(.bordered)
            }

            List(session.events) { event in
                HStack {
                    Text("Expected \(event.expected.midiNote)")
                    Spacer()
                    Text(event.state.rawValue.capitalized)
                        .foregroundColor(color(for: event.state))
                }
            }

            Button("Restart") {
                session.restart()
            }
        }
        .padding()
        .navigationTitle("Practice")
    }

    private func color(for state: NoteEventState) -> Color {
        switch state {
        case .correct: return Theme.success
        case .wrong, .missed: return Theme.error
        }
    }
}
