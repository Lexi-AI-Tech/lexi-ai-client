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
  storeOAuthVerifier: `${API_V1_PREFIX}/auth/oauth/verifier`,
  websocketAuth: (state: string) =>
    `${API_V1_PREFIX}/auth/ws/auth/${encodeURIComponent(state)}`,
} as const;

/**
 * Speech-to-Text (STT) endpoints
 */
export const STT_ENDPOINTS = {
  transcribe: `${API_V1_PREFIX}/stt`,
} as const;

/**
 * Transcript endpoints
 */
export const TRANSCRIPT_ENDPOINTS = {
  list: (params?: string) =>
    `${API_V1_PREFIX}/transcripts${params ? `?${params}` : ""}`,
  get: (id: number | string) => `${API_V1_PREFIX}/transcripts/${id}`,
  delete: (id: number | string) => `${API_V1_PREFIX}/transcripts/${id}`,
} as const;

/**
 * User endpoints
 */
export const USER_ENDPOINTS = {
  profile: `${API_V1_PREFIX}/users/me`,
  stats: `${API_V1_PREFIX}/users/me/stats`,
} as const;

/**
 * App Config endpoints
 */
export const APP_CONFIG_ENDPOINTS = {
  get: (params?: string) =>
    `${API_V1_PREFIX}/app-config${params ? `?${params}` : ""}`,
  update: `${API_V1_PREFIX}/app-config`,
} as const;

/**
 * Action endpoints
 */
export const ACTION_ENDPOINTS = {
  perform: `${API_V1_PREFIX}/actions/perform`,
  history: (params?: string) =>
    `${API_V1_PREFIX}/actions/history${params ? `?${params}` : ""}`,
  deleteHistory: (id: string) => `${API_V1_PREFIX}/actions/history/${id}`,
  triggers: (params?: string) =>
    `${API_V1_PREFIX}/actions/triggers${params ? `?${params}` : ""}`,
  createTrigger: `${API_V1_PREFIX}/actions/triggers`,
  updateTrigger: (id: string) => `${API_V1_PREFIX}/actions/triggers/${id}`,
  deleteTrigger: (id: string) => `${API_V1_PREFIX}/actions/triggers/${id}`,
} as const;

/**
 * Shortcuts endpoints
 */
export const SHORTCUTS_ENDPOINTS = {
  list: (params?: string) =>
    `${API_V1_PREFIX}/shortcuts${params ? `?${params}` : ""}`,
  create: `${API_V1_PREFIX}/shortcuts`,
  update: (id: string) => `${API_V1_PREFIX}/shortcuts/${id}`,
  delete: (id: string) => `${API_V1_PREFIX}/shortcuts/${id}`,
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

/**
 * Helper function to build WebSocket URL from endpoint
 * Converts http:// to ws:// and https:// to wss://
 */
export function getWebSocketUrl(endpoint: string): string {
  const baseUrl = API_BASE_URL;
  const wsProtocol = baseUrl.startsWith("https") ? "wss" : "ws";
  const wsBaseUrl = baseUrl.replace(/^https?/, wsProtocol);
  return `${wsBaseUrl}${endpoint}`;
}
