import SwiftUI

@main
struct VersaApp: App {
    @State private var engine = TaskEngine()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(engine)
        }
    }
}
