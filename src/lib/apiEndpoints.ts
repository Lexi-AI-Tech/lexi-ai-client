/**
 * API Endpoints
 *
 * Centralized definition of all API endpoints used in the application.
 * This ensures consistency and makes it easy to update endpoints in one place.
 */

// Use localhost in development, production URL in production builds
// Can be overridden with VITE_API_BASE_URL environment variable
export const API_BASE_URL =
  import.meta.env.MODE === "development"
    ? "http://localhost:1230"
    : "https://lexi-ai-server.onrender.com";

// API version prefix
const API_V1_PREFIX = "/api/v1";

/**
 * Authentication endpoints
 */
export const AUTH_ENDPOINTS = {
  refresh: `${API_V1_PREFIX}/auth/refresh`,
  googleUrl: `${API_V1_PREFIX}/auth/google/url`,
  googleCallback: `${API_V1_PREFIX}/auth/google/callback`,
  google: `${API_V1_PREFIX}/auth/google`,
  me: `${API_V1_PREFIX}/auth/me`,
  logout: `${API_V1_PREFIX}/auth/logout`,
  oauthVerifier: (state: string) =>
    `${API_V1_PREFIX}/auth/oauth/verifier/${encodeURIComponent(state)}`,
  oauthStatus: (state: string) =>
    `${API_V1_PREFIX}/auth/oauth/status/${encodeURIComponent(state)}`,
  storeOAuthVerifier: `${API_V1_PREFIX}/auth/oauth/verifier`,
} as const;

/**
 * Speech-to-Text (STT) endpoints
 */
export const STT_ENDPOINTS = {
  transcribe: `${API_V1_PREFIX}/stt`,
  transcripts: (params?: string) =>
    `${API_V1_PREFIX}/stt/transcripts${params ? `?${params}` : ""}`,
  transcript: (id: number | string) => `${API_V1_PREFIX}/stt/transcripts/${id}`,
} as const;

/**
 * User endpoints
 */
export const USER_ENDPOINTS = {
  profile: `${API_V1_PREFIX}/users/me`,
  stats: `${API_V1_PREFIX}/users/me/stats`,
  config: (params?: string) =>
    `${API_V1_PREFIX}/users/me/config${params ? `?${params}` : ""}`,
} as const;

/**
 * Action endpoints
 */
export const ACTION_ENDPOINTS = {
  perform: `${API_V1_PREFIX}/actions/perform`,
} as const;

/**
 * Text-to-Speech (TTS) endpoints
 */
export const TTS_ENDPOINTS = {
  speak: `${API_V1_PREFIX}/tts/speak`,
} as const;

/**
 * Helper function to build full URL from endpoint
 */
export function getApiUrl(endpoint: string): string {
  return `${API_BASE_URL}${endpoint}`;
}
