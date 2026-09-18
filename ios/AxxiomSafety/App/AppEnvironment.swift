import Foundation

/// Build-time configuration read from Info.plist (values come from the xcconfig for the scheme).
struct AppEnvironment: Sendable {
    let name: String
    let apiBaseURL: URL
    let supabaseURL: URL
    let supabaseAnonKey: String

    static let current: AppEnvironment = {
        let info = Bundle.main.infoDictionary ?? [:]
        func string(_ key: String) -> String { (info[key] as? String) ?? "" }
        return AppEnvironment(
            name: string("AppEnvironment").isEmpty ? "dev" : string("AppEnvironment"),
            apiBaseURL: URL(string: string("APIBaseURL")) ?? URL(string: "https://localhost")!,
            supabaseURL: URL(string: string("SupabaseURL")) ?? URL(string: "https://localhost")!,
            supabaseAnonKey: string("SupabaseAnonKey")
        )
    }()

    var isProduction: Bool { name == "prod" }
}
