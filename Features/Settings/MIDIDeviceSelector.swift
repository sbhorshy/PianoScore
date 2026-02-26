import SwiftUI

struct MIDIDeviceSelector: View {
    let devices: [String]
    @Binding var selected: String?

    var body: some View {
        Picker("MIDI Device", selection: $selected) {
            Text("None").tag(String?.none)
            ForEach(devices, id: \.self) { name in
                Text(name).tag(String?.some(name))
            }
        }
        .pickerStyle(.menu)
    }
}
