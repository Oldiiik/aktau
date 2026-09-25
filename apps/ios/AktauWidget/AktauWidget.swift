import ActivityKit
import SwiftUI
import WidgetKit

// WidgetKit decides when to refresh; we only suggest the next date (the
// backend's `refresh_after`, which lands on the next known transition). The
// last good payload is cached in the App Group and shown with its timestamp
// when the network is unavailable.

struct AktauEntry: TimelineEntry {
    let date: Date
    let state: WidgetState
    let isStale: Bool
}

struct AktauProvider: TimelineProvider {
    private let client = AktauClient()

    func placeholder(in context: Context) -> AktauEntry { AktauEntry(date: .now, state: .placeholder, isStale: false) }

    func getSnapshot(in context: Context, completion: @escaping (AktauEntry) -> Void) {
        completion(AktauEntry(date: .now, state: client.cachedState() ?? .placeholder, isStale: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AktauEntry>) -> Void) {
        Task {
            do {
                let state = try await client.widgetState()
                let next = max(state.refreshAfter, .now.addingTimeInterval(5 * 60))
                completion(Timeline(entries: [AktauEntry(date: .now, state: state, isStale: false)], policy: .after(next)))
            } catch {
                let cached = client.cachedState() ?? .placeholder
                completion(Timeline(entries: [AktauEntry(date: .now, state: cached, isStale: true)], policy: .after(.now.addingTimeInterval(15 * 60))))
            }
        }
    }
}

struct AktauWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: AktauEntry

    var body: some View {
        Group {
            switch family {
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.state.headline).font(.headline).lineLimit(2)
                    if let d = entry.state.detail { Text(d).font(.caption).lineLimit(1) }
                }
            case .accessoryInline:
                Text(entry.state.headline)
            default:
                WidgetCard(state: entry.state, compact: family == .systemSmall, isStale: entry.isStale)
            }
        }
        .widgetURL(URL(string: entry.state.deep_link))
        .containerBackground(for: .widget) { entry.state.status.background }
    }
}

struct AktauNowWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AktauNow", provider: AktauProvider()) { AktauWidgetView(entry: $0) }
            .configurationDisplayName("Aktau Now")
            .description("What affects your home right now — from official sources.")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

struct AktauLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AktauActivityAttributes.self) { ctx in
            VStack(alignment: .leading, spacing: 4) {
                Text(ctx.attributes.place.uppercased()).font(.system(size: 11, weight: .bold)).foregroundStyle(AktauColor.secondary)
                Text(ctx.state.headline).font(.system(size: 17, weight: .bold))
                if let d = ctx.state.detail { Text(d).font(.system(size: 13, weight: .medium)).foregroundStyle(AktauColor.secondary) }
            }
            .padding(16)
            .activityBackgroundTint(AktauColor.redSoft)
            .widgetURL(URL(string: "aktau://event/\(ctx.attributes.eventId)"))
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Image(systemName: "bolt.slash").foregroundStyle(AktauColor.red) }
                DynamicIslandExpandedRegion(.center) { Text(ctx.state.headline).font(.headline).lineLimit(1) }
                DynamicIslandExpandedRegion(.bottom) { Text(ctx.state.detail ?? ctx.attributes.place).font(.caption) }
            } compactLeading: {
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(AktauColor.red)
            } compactTrailing: {
                Text(ctx.state.detail?.components(separatedBy: "·").last?.trimmingCharacters(in: .whitespaces) ?? "").font(.caption2).lineLimit(1)
            } minimal: {
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(AktauColor.red)
            }
            .widgetURL(URL(string: "aktau://event/\(ctx.attributes.eventId)"))
        }
    }
}

@main
struct AktauWidgetBundle: WidgetBundle {
    var body: some Widget {
        AktauNowWidget()
        AktauLiveActivity()
    }
}
