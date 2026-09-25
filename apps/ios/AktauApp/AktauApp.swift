import ActivityKit
import SafariServices
import SwiftUI
import WidgetKit

@main
struct AktauApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                // aktau://event/{id} → the exact event (web equivalent /event/{id}).
                .onOpenURL { model.open(deepLink: $0) }
                .task { await model.start() }
        }
    }
}

@Observable
final class AppModel {
    var state: WidgetState?
    var error: String?
    var baseURL: String = AktauConfig.baseURL.absoluteString
    var sheetURL: URL?
    var homeQuery: String = ""
    var homeLabel: String?
    private let client = AktauClient()

    @MainActor
    func setHome() async {
        homeLabel = try? await AktauClient().setHome(query: homeQuery)
        await refresh()
    }

    func start() async {
        state = client.cachedState()
        await client.registerDevice()
        await refresh()
    }

    @MainActor
    func refresh() async {
        if let url = URL(string: baseURL) { AktauConfig.baseURL = url }
        do {
            let s = try await AktauClient().widgetState()
            state = s
            error = nil
            WidgetCenter.shared.reloadAllTimelines()
            await LiveActivityManager.sync(with: s)
        } catch {
            self.error = "Couldn’t reach \(baseURL). Showing last confirmed state."
        }
    }

    func open(deepLink: URL) {
        sheetURL = AktauClient().webURL(for: deepLink)
    }
}

/// Starts / updates / ends the Live Activity from the same backend state.
enum LiveActivityManager {
    @MainActor
    static func sync(with s: WidgetState) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let current = Activity<AktauActivityAttributes>.activities
        guard s.status == .DISRUPTION, let id = s.event_id else {
            for a in current { await a.end(nil, dismissalPolicy: .default) }
            return
        }
        let content = ActivityContent(state: AktauActivityAttributes.ContentState(headline: s.headline, detail: s.detail, status: s.status.rawValue, updatedAt: s.updatedAt), staleDate: s.refreshAfter.addingTimeInterval(3600))
        if let a = current.first(where: { $0.attributes.eventId == id }) {
            await a.update(content)
        } else {
            for a in current { await a.end(nil, dismissalPolicy: .immediate) }
            _ = try? Activity.request(attributes: AktauActivityAttributes(eventId: id, place: s.location_label), content: content)
        }
    }
}

struct ContentView: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Aktau Now").font(.system(size: 30, weight: .bold)).tracking(-0.9)
                    if let s = model.state {
                        WidgetCard(state: s)
                            .padding(16)
                            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
                            .background(s.status.background, in: RoundedRectangle(cornerRadius: 20))
                        if let link = URL(string: s.deep_link), s.event_id != nil {
                            Button("View interruption") { model.open(deepLink: link) }
                                .buttonStyle(AktauButtonStyle())
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 150)
                    }
                    if let e = model.error { Text(e).font(.footnote).foregroundStyle(AktauColor.secondary) }
                    Text("The home-screen widget and Live Activity show this same payload from GET /api/widget/state. Add the “Aktau Now” widget from the widget gallery.")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(AktauColor.secondary)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Home").font(.system(size: 12, weight: .semibold)).foregroundStyle(AktauColor.secondary)
                        HStack {
                            TextField("14 21", text: $model.homeQuery)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .padding(12).background(AktauColor.surface, in: RoundedRectangle(cornerRadius: 12))
                            Button("Set") { Task { await model.setHome() } }.buttonStyle(AktauButtonStyle(secondary: true)).frame(width: 80)
                        }
                        if let h = model.homeLabel { Text("Home: \(h)").font(.caption).foregroundStyle(AktauColor.secondary) }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Server").font(.system(size: 12, weight: .semibold)).foregroundStyle(AktauColor.secondary)
                        TextField("https://…", text: $model.baseURL)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                            .padding(12).background(AktauColor.surface, in: RoundedRectangle(cornerRadius: 12))
                        Text("Installation \(AktauConfig.installationId.prefix(8))… · no account").font(.caption).foregroundStyle(AktauColor.secondary)
                    }
                    Button("Refresh") { Task { await model.refresh() } }.buttonStyle(AktauButtonStyle(secondary: true))
                }
                .padding(24)
            }
            .background(Color(light: 0xF7F9FC, dark: 0x0C1421))
            .refreshable { await model.refresh() }
        }
        .sheet(item: Binding(get: { model.sheetURL.map(IdentifiedURL.init) }, set: { model.sheetURL = $0?.url })) { SafariView(url: $0.url).ignoresSafeArea() }
    }
}

struct IdentifiedURL: Identifiable { let url: URL; var id: String { url.absoluteString } }

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

struct AktauButtonStyle: ButtonStyle {
    var secondary = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .bold))
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(secondary ? AktauColor.blue : .white)
            .background(secondary ? AktauColor.soft : AktauColor.blue, in: RoundedRectangle(cornerRadius: 16))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
