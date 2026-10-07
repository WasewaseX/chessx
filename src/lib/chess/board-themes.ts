// Board themes: [light, dark] square colors.
export const BOARD_THEMES: Record<string, { name: string; light: string; dark: string }> = {
  green: { name: 'Green', light: '#ebecd0', dark: '#739552' },
  brown: { name: 'Brown', light: '#f0d9b5', dark: '#b58863' },
  slate: { name: 'Slate', light: '#dee3e6', dark: '#8ca2ad' },
  walnut: { name: 'Walnut', light: '#e8d7ba', dark: '#a3845c' },
}

export function boardColors(theme: string) {
  return BOARD_THEMES[theme] ?? BOARD_THEMES.green
}
