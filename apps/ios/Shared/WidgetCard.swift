import SwiftUI

/// The Aktau Now card, shared by the widget and the app's preview so both
/// render exactly the same payload.
struct WidgetCard: View {
    let state: WidgetState
    var compact = false
    var isStale = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 4 : 6) {
            HStack(spacing: 6) {
                Circle().fill(state.status.tint).frame(width: 8, height: 8)
                Text(state.location_label.uppercased())
                    .font(.system(size: 10, weight: .bold)).foregroundStyle(AktauColor.secondary).lineLimit(1)
                Spacer(minLength: 0)
            }
            Text(state.headline)
                .font(.system(size: compact ? 15 : 17, weight: .bold)).foregroundStyle(AktauColor.text)
                .lineLimit(compact ? 3 : 2).minimumScaleFactor(0.85)
            if let detail = state.detail {
                Text(detail).font(.system(size: 12, weight: .medium)).foregroundStyle(AktauColor.secondary).lineLimit(2)
            }
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline) {
                if let t = state.weather?.temperature_c, !compact {
                    Text("\(Int(t.rounded()))°").font(.system(size: 13, weight: .semibold)).foregroundStyle(AktauColor.text)
                    if let w = state.weather?.wind_ms { Text("· \(Int(w.rounded())) m/s").font(.system(size: 11, weight: .medium)).foregroundStyle(AktauColor.secondary) }
                }
                Spacer(minLength: 0)
                Text(isStale ? "Last confirmed \(state.updatedAt.formatted(date: .omitted, time: .shortened))" : state.updatedAt.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 10, weight: .medium)).foregroundStyle(AktauColor.secondary)
            }
        }
    }
}
