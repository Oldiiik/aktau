import ActivityKit
import Foundation

/// Live Activity for significant ACTIVE incidents affecting the user only
/// (never for trivial notices). ETA changes update it; resolution ends it.
struct AktauActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var headline: String
        var detail: String?
        var status: String
        var updatedAt: Date
    }

    var eventId: String
    var place: String
}
