import SwiftUI

@main
struct VersaApp: App {
    @State private var authenticated = false
    @State private var engine: TaskEngine?

    var body: some Scene {
        WindowGroup {
            Group {
                if authenticated, let engine {
                    ContentView()
                        .environment(engine)
                } else {
                    LoginView {
                        engine = TaskEngine()
                        authenticated = true
                    }
                }
            }
            .task {
                // If a refresh token is already in Keychain, skip the login screen.
                authenticated = await KimbuAuth.shared.isAuthenticated()
                if authenticated { engine = TaskEngine() }
            }
        }
    }
}
