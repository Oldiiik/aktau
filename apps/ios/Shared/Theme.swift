import SwiftUI

/// Aktau semantic tokens (Figma: Aktau · Foundations), light + "Night in Aktau".
enum AktauColor {
    static let blue = Color(light: 0x0868D9, dark: 0x58A6FF)
    static let text = Color(light: 0x101828, dark: 0xF3F7FC)
    static let secondary = Color(light: 0x65758B, dark: 0xA8B7CB)
    static let surface = Color(light: 0xFFFFFF, dark: 0x162234)
    static let soft = Color(light: 0xEBF4FE, dark: 0x1B2B43)
    static let amber = Color(light: 0x98610A, dark: 0xF0B45A)
    static let amberSoft = Color(light: 0xFFF5E5, dark: 0x33270F)
    static let red = Color(light: 0xCA414D, dark: 0xFF7B86)
    static let redSoft = Color(light: 0xFFF0F1, dark: 0x3A1B22)
    static let green = Color(light: 0x14845D, dark: 0x56D7A3)
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

extension WidgetState.Status {
    var tint: Color {
        switch self {
        case .CALM: AktauColor.blue
        case .ATTENTION: AktauColor.amber
        case .DISRUPTION: AktauColor.red
        case .UNKNOWN: AktauColor.secondary
        }
    }
    var background: Color {
        switch self {
        case .CALM: AktauColor.surface
        case .ATTENTION: AktauColor.amberSoft
        case .DISRUPTION: AktauColor.redSoft
        case .UNKNOWN: AktauColor.soft
        }
    }
}
