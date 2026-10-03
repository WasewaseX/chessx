// Board themes: [light, dark] square colors.
export const BOARD_THEMES: Record<string, { name: string; light: string; dark: string; frame: string }> = {
  green: { name: 'Green', light: '#ebecd0', dark: '#739552', frame: '#5d7f43' },
  brown: { name: 'Brown', light: '#f0d9b5', dark: '#b58863', frame: '#96683f' },
  slate: { name: 'Slate', light: '#dee3e6', dark: '#8ca2ad', frame: '#6f8794' },
  walnut: { name: 'Walnut', light: '#e8d7ba', dark: '#a3845c', frame: '#7c6039' },
}

export function boardColors(theme: string) {
  return BOARD_THEMES[theme] ?? BOARD_THEMES.green
}
