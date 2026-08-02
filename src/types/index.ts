/**
 * Common Type Definitions
 *
 * All TypeScript interfaces and types used across the application.
 * This file serves as the single source of truth for type definitions.
 */

import { LanguageCode } from "../lib/constants";

// ============================================================================
// API Types
// ============================================================================

export interface ApiResponse<T = any> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
  [key: string]: any;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };
  expires_in?: number;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
}

export interface AuthData {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: AuthUser;
}

/**
 * Auth state exposed to the renderer.
 *
 * Source of truth is the Rust backend. Tokens are intentionally not exposed to
 * the frontend to avoid stale/duplicated state and to keep business logic in Rust.
 */
export interface AuthUiState {
  is_authenticated: boolean;
  user?: AuthUser | null;
  expires_at?: number | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  checkAuth: () => Promise<void>;
}

// ============================================================================
// App Configuration Types
// ============================================================================

/**
 * App config exposed by Rust (`get_app_config`, `update_app_config`, etc.).
 * React never talks to the server directly; this mirrors the Tauri command payload.
 */
export interface AppConfig {
  languages?: LanguageCode[] | null;
  hotkeys?: string[] | null;
  action_hotkeys?: string[] | null;
  enhance_transcription?: boolean | null;
  launch_on_system_startup?: boolean | null;
  show_icon?: boolean | null;
  vocabulary?: string[] | null;
  shortcuts?: Shortcut[] | null;
}

export interface DocContentResponse {
  title: string;
  content: string;
}

// ============================================================================
// Transcript Types
// ============================================================================

export interface Transcript {
  id: string;
  created_by: string;
  updated_by: string;
  original_text: string;
  original_text_word_count: number;
  original_text_character_count: number;
  is_enhanced: boolean;
  enhanced_text: string | null;
  enhanced_text_word_count: number | null;
  enhanced_text_character_count: number | null;
  audio_file_url: string | null;
  audio_file_size: number | null;
  focused_app: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PaginatedTranscriptsResponse {
  transcripts: Transcript[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ============================================================================
// Notes Types
// ============================================================================

export interface Note {
  id: string;
  team_id: string;
  created_by: string;
  updated_by: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface NoteCreateRequest {
  content: string;
}

export interface NoteUpdateRequest {
  content?: string;
}

export interface PaginatedNotesResponse {
  notes: Note[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ============================================================================
// Docs Types (rich-text, Notion-style)
// ============================================================================

export interface Doc {
  id: string;
  title: string;
  /** Markdown string (canonical) */
  content: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// UI Component Types
// ============================================================================

export interface HotkeyConfig {
  hotkeys: string[]; // Array of up to 3 hotkeys (e.g., ["Fn", "Cmd+Shift+R", "Ctrl+Alt+T"])
}

export interface NetworkStatus {
  isOnline: boolean;
  isChecking: boolean;
  retry: () => Promise<void>;
}

// ============================================================================
// Onboarding Types
// ============================================================================

export type OnboardingStep =
  | "welcome"
  | "permissions"
  | "hotkey-test"
  | "microphone-test"
  | "home";

export interface OnboardingState {
  currentStep: OnboardingStep;
  isCompleted: boolean;
  isInitialized?: boolean;
  setStep: (step: OnboardingStep) => Promise<void>;
  nextStep: () => Promise<void>;
  previousStep: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
  /** Re-fetch onboarding state from backend (e.g. after auth_expired reset). */
  refreshState: () => Promise<void>;
}

// ============================================================================
// Component Props Types
// ============================================================================

export interface GoogleLoginButtonProps {
  onSuccess?: (user: any) => void;
  onError?: (error: string) => void;
}

export interface SidebarProps {
  currentPage:
    | "home"
    | "transcripts"
    | "settings"
    | "vocabulary"
    | "actions"
    | "shortcuts"
    | "notes"
    | "meetings"
    | "docs";
  onNavigate: (
    page:
      | "home"
      | "transcripts"
      | "settings"
      | "vocabulary"
      | "actions"
      | "shortcuts"
      | "notes"
      | "meetings"
      | "docs",
  ) => void;
}

// ============================================================================
// Action Types
// ============================================================================

export interface ActionHistory {
  id: string;
  created_by: string;
  updated_by: string;
  action_command: string;
  app_name: string | null;
  selected_text: string | null;
  action_type: string;
  output_value: string | null;
  output_audio_file_path: string | null;
  output_audio_file_size: number | null;
  output_audio_file_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedActionHistoryResponse {
  actions: ActionHistory[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface Shortcut {
  id: string;
  shortcut: string;
  value: string;
}

export interface ShortcutCreateRequest {
  shortcut: string;
  value: string;
}

export interface ShortcutUpdateRequest {
  shortcut?: string;
  value?: string;
}

export interface PermissionState {
  granted: boolean;
  checking: boolean;
}
