import Foundation

/// Configuration shared between the app and the widget through the App Group.
enum AktauConfig {
    static let appGroup = "group.kz.aktau.app"
    static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    /// The same backend the web app uses. Defaults to the local dev server.
    static var baseURL: URL {
        get { URL(string: defaults.string(forKey: "baseURL") ?? "http://localhost:3000")! }
        set { defaults.set(newValue.absoluteString, forKey: "baseURL") }
    }

    /// Random, account-free installation id. Not a credential; no personal data.
    static var installationId: String {
        if let id = defaults.string(forKey: "installationId") { return id }
        let id = UUID().uuidString.lowercased()
        defaults.set(id, forKey: "installationId")
        return id
    }

    static var language: String {
        if let l = defaults.string(forKey: "lang") { return l }
        let pref = Locale.preferredLanguages.first ?? "en"
        return pref.hasPrefix("kk") ? "kk" : pref.hasPrefix("ru") ? "ru" : "en"
    }
}

struct AktauClient {
    enum ClientError: Error { case badStatus(Int) }

    var base: URL = AktauConfig.baseURL

    /// GET /api/widget/state — cached in the App Group so the widget can show the
    /// last confirmed state (with its timestamp) when the network is unavailable.
    func widgetState() async throws -> WidgetState {
        var c = URLComponents(url: base.appending(path: "api/widget/state"), resolvingAgainstBaseURL: false)!
        c.queryItems = [.init(name: "installation", value: AktauConfig.installationId), .init(name: "lang", value: AktauConfig.language)]
        var req = URLRequest(url: c.url!, timeoutInterval: 12)
        req.setValue("application/json", forHTTPHeaderField: "accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { throw ClientError.badStatus(http.statusCode) }
        let state = try JSONDecoder().decode(WidgetState.self, from: data)
        AktauConfig.defaults.set(data, forKey: "lastWidgetState")
        return state
    }

    func cachedState() -> WidgetState? {
        guard let data = AktauConfig.defaults.data(forKey: "lastWidgetState") else { return nil }
        return try? JSONDecoder().decode(WidgetState.self, from: data)
    }

    /// POST /api/device/register (push token added once APNs/FCM is configured).
    func registerDevice(pushToken: String? = nil) async {
        var req = URLRequest(url: base.appending(path: "api/device/register"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        var body: [String: String] = ["installation_id": AktauConfig.installationId, "platform": "ios", "language": AktauConfig.language]
        if let pushToken { body["push_token"] = pushToken }
        req.httpBody = try? JSONEncoder().encode(body)
        _ = try? await URLSession.shared.data(for: req)
    }

    /// Sets home from "14 21"-style input using the local district/building index.
    func setHome(query: String) async throws -> String? {
        var c = URLComponents(url: base.appending(path: "api/areas/search"), resolvingAgainstBaseURL: false)!
        c.queryItems = [.init(name: "q", value: query), .init(name: "lang", value: AktauConfig.language)]
        let (data, _) = try await URLSession.shared.data(from: c.url!)
        struct Hit: Decodable { let kind: String; let id: String; let label: String }
        struct Results: Decodable { let results: [Hit] }
        guard let hit = try JSONDecoder().decode(Results.self, from: data).results.first else { return nil }
        var req = URLRequest(url: base.appending(path: "api/me/locations"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue(AktauConfig.installationId, forHTTPHeaderField: "x-installation-id")
        let body: [String: String] = hit.kind == "building" ? ["label": "Home", "type": "HOME", "building_id": hit.id] : ["label": "Home", "type": "HOME", "area_id": hit.id]
        req.httpBody = try JSONEncoder().encode(body)
        _ = try await URLSession.shared.data(for: req)
        return hit.label
    }

    /// Canonical web equivalent of aktau://event/{id}.
    func webURL(for deepLink: URL) -> URL {
        if deepLink.host() == "event", let id = deepLink.pathComponents.last { return base.appending(path: "event/\(id)") }
        return base
    }
}
