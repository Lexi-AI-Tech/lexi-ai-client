/**
 * Lexi AI Design System - Color Theme and Constants
 *
 * This file defines the color palette and design system constants
 * that match the Lexi AI website design. These values are used throughout
 * the frontend application for consistent visual identity.
 *
 * The color scheme is based on a dark, sophisticated design with vibrant accent colors.
 */

/**
 * Background Colors
 */
export const bg = {
  /** Primary background color - darkest shade */
  primary: "#09090b",
  /** Secondary background color - slightly lighter */
  secondary: "#0f0f12",
  /** Tertiary background color - for elevated surfaces */
  tertiary: "#18181b",
  /** Card background with transparency */
  card: "rgba(24, 24, 27, 0.6)",
  /** Card background on hover */
  cardHover: "rgba(39, 39, 42, 0.8)",
} as const;

/**
 * Text Colors
 */
export const text = {
  /** Primary text color - highest contrast */
  primary: "#fafafa",
  /** Secondary text color - medium contrast */
  secondary: "#a1a1aa",
  /** Muted text color - lowest contrast */
  muted: "#71717a",
} as const;

/**
 * Accent Colors
 */
export const accent = {
  /** Red accent - used for recording states and primary actions */
  red: "#ff6b6b",
  /** Teal accent - used for success states and highlights */
  teal: "#4ecdc4",
  /** Purple accent - used for gradients and special highlights */
  purple: "#a855f7",
  /** Blue accent - used for informational states */
  blue: "#3b82f6",
  /** Pink accent - used in button gradients */
  pink: "#ec4899",
} as const;

/**
 * Border Colors
 */
export const border = {
  /** Subtle border - very low opacity */
  subtle: "rgba(255, 255, 255, 0.06)",
  /** Light border - slightly more visible */
  light: "rgba(255, 255, 255, 0.1)",
} as const;

/**
 * Gradients
 */
export const gradients = {
  /** Primary gradient - red to purple to teal */
  primary: "linear-gradient(135deg, #ff6b6b 0%, #a855f7 50%, #4ecdc4 100%)",
  /** Text gradient - horizontal red to purple to teal */
  text: "linear-gradient(90deg, #ff6b6b 0%, #a855f7 50%, #4ecdc4 100%)",
  /** Button gradient - red to pink */
  button: "linear-gradient(135deg, #ff6b6b 0%, #ec4899 100%)",
} as const;

/**
 * Typography
 */
export const typography = {
  /** Display font family (for headings) */
  fontDisplay:
    "'Cabinet Grotesk', -apple-system, BlinkMacSystemFont, sans-serif",
  /** Body font family (for body text) */
  fontBody: "'Satoshi', -apple-system, BlinkMacSystemFont, sans-serif",
} as const;

/**
 * Spacing
 */
export const spacing = {
  /** Section padding */
  sectionPadding: "120px",
  /** Container max width */
  containerMax: "1200px",
} as const;

/**
 * Shadow Effects
 */
export const shadows = {
  /** Glow shadow with purple tint */
  glow: "0 0 60px rgba(168, 85, 247, 0.3)",
  /** Card shadow */
  card: "0 4px 24px rgba(0, 0, 0, 0.4)",
} as const;

/**
 * Transitions
 */
export const transitions = {
  /** Fast transition (150ms) */
  fast: "150ms cubic-bezier(0.4, 0, 0.2, 1)",
  /** Base transition (300ms) */
  base: "300ms cubic-bezier(0.4, 0, 0.2, 1)",
  /** Slow transition (500ms) */
  slow: "500ms cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

/**
 * Complete theme object
 */
export const theme = {
  bg,
  text,
  accent,
  border,
  gradients,
  typography,
  spacing,
  shadows,
  transitions,
} as const;

export default theme;
