import Foundation

/// Mirror of `WidgetState` in packages/types — the compact, precomputed payload
/// returned by GET /api/widget/state. The widget renders it verbatim and never
/// re-derives relevance or city logic.
struct WidgetState: Codable, Equatable {
    enum Status: String, Codable { case CALM, ATTENTION, DISRUPTION, UNKNOWN }
    struct Weather: Codable, Equatable {
        let temperature_c: Double?
        let wind_ms: Double?
        let provider: String
    }

    let status: Status
    let headline: String
    let detail: String?
    let event_id: String?
    let deep_link: String
    let weather: Weather?
    let location_label: String
    let updated_at: String
    let refresh_after: String

    var updatedAt: Date { ISO8601DateFormatter.aktau.date(from: updated_at) ?? .now }
    var refreshAfter: Date { ISO8601DateFormatter.aktau.date(from: refresh_after) ?? .now.addingTimeInterval(1800) }

    static let placeholder = WidgetState(
        status: .CALM, headline: "All clear near home", detail: nil, event_id: nil, deep_link: "aktau://home",
        weather: .init(temperature_c: 21, wind_ms: 8, provider: "Open-Meteo"), location_label: "Home · 14 microdistrict",
        updated_at: ISO8601DateFormatter.aktau.string(from: .now), refresh_after: ISO8601DateFormatter.aktau.string(from: .now.addingTimeInterval(1800)))
}

extension ISO8601DateFormatter {
    static let aktau: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
