import SwiftUI

struct StaffView: View {
    let notes: [Note]

    var body: some View {
        GeometryReader { geo in
            ZStack {
                VStack(spacing: geo.size.height / 6) {
                    ForEach(0..<5, id: \.self) { _ in
                        Rectangle()
                            .fill(Color.gray.opacity(0.5))
                            .frame(height: 1)
                    }
                }

                HStack(spacing: 12) {
                    ForEach(notes) { note in
                        Circle()
                            .fill(note.isRest ? Color.clear : Theme.accent)
                            .overlay(Circle().stroke(Theme.accent, lineWidth: 1))
                            .frame(width: 14, height: 14)
                    }
                }
            }
        }
    }
}
