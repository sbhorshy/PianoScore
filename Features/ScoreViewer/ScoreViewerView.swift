import SwiftUI

struct ScoreViewerView: View {
    let score: Score

    var body: some View {
        VStack(spacing: 16) {
            Text(score.title)
                .font(.title2)
                .bold()

            StaffView(notes: score.allNotes)
                .frame(height: 120)

            NavigationLink("Start Practice") {
                PracticeView(score: score)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
