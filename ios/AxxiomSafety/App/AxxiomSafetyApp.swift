import SwiftData
import SwiftUI

@main
struct AxxiomSafetyApp: App {
    @State private var session = SessionStore(provider: SupabaseAuthProvider(environment: .current))
    @State private var router = AppRouter()
    @State private var connectivity = Connectivity()
    @State private var manualStore = ManualStore(environment: .current)
    private let container = PersistenceController.shared.container

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(router)
                .environment(connectivity)
                .environment(manualStore)
                .modelContainer(container)
                .task {
                    await session.restore()
                    connectivity.start()
                }
        }
    }
}
