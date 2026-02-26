import SwiftUI

@main
struct PianoScoreApp: App {
    var body: some Scene {
        WindowGroup {
            ScoreListView(viewModel: ScoreListViewModel(loader: ScoreLoader()))
        }
    }
}
