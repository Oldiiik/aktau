// Aktau design tokens (Figma: Aktau · Foundations). Single reference for all
// clients: the web app mirrors these as CSS variables (apps/web globals.css),
// the iOS widget in Shared/Theme.swift.
export const color = {
  light: {
    bg: '#f7f9fc', surface: '#ffffff', soft: '#ebf4fe', text: '#101828', secondary: '#65758b', blue: '#0868d9',
    green: '#14845d', greenSoft: '#eaf7f0', amber: '#98610a', amberSoft: '#fff5e5', red: '#ca414d', redSoft: '#fff0f1',
    border: '#e7edf4', black: '#080e17', white: '#ffffff', sea: '#bce0eb',
  },
  dark: {
    bg: '#0c1421', surface: '#162234', soft: '#1b2b43', text: '#f3f7fc', secondary: '#a8b7cb', blue: '#58a6ff',
    green: '#56d7a3', greenSoft: '#12302a', amber: '#f0b45a', amberSoft: '#33270f', red: '#ff7b86', redSoft: '#3a1b22',
    border: '#24344b', black: '#080e17', white: '#ffffff', sea: '#15344a',
  },
} as const

export const space = { 0: 0, 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40 } as const
export const radius = { card: 20, button: 16, sheet: 28, chip: 999, screen: 40 } as const
export const type = {
  display: { size: 38, weight: 700, tracking: -1.14 },
  title: { size: 30, weight: 700, tracking: -0.9 },
  section: { size: 20, weight: 700 },
  card: { size: 16, weight: 600 },
  body: { size: 14, weight: 500 },
  meta: { size: 12, weight: 500 },
  navigation: { size: 11, weight: 600 },
  lineHeight: 1.4,
  family: 'Manrope',
} as const
/** Motion (Figma: Trust and motion). */
export const motion = { tapMs: [100, 160], sheetMs: [250, 350], beaconPulseMs: [600, 900], beaconLoops: false } as const
export const minTapTarget = 44
