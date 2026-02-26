import SwiftUI

final class ScoreListViewModel: ObservableObject {
    @Published var scores: [Score] = []

    private let loader: ScoreLoader

    init(loader: ScoreLoader) {
        self.loader = loader
        self.scores = loader.loadDemoScores()
    }
}

struct ScoreListView: View {
    @StateObject var viewModel: ScoreListViewModel

    var body: some View {
        NavigationView {
            List(viewModel.scores) { score in
                NavigationLink(destination: ScoreViewerView(score: score)) {
                    VStack(alignment: .leading) {
                        Text(score.title).font(.headline)
                        Text("\(score.measures.count) measures")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("PianoScore")
        }
    }
}
