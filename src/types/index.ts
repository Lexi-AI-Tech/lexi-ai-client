/**
 * Common Type Definitions
 *
 * All TypeScript interfaces and types used across the application.
 * This file serves as the single source of truth for type definitions.
 */

import { DeviceType, LanguageCode } from "../lib/constants";

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

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;
  setAuthData: (tokens: AuthTokens, user: AuthUser) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  refreshTokenIfNeeded: () => Promise<boolean>;
  checkAuth: () => Promise<void>;
}

// ============================================================================
// App Configuration Types
// ============================================================================

/**
 * AppConfig from server API (complete config with all fields)
 */
export interface AppConfig {
  system_type: string;
  device_type: DeviceType;
  hotkeys: string[];
  languages: LanguageCode[];
  enhance_transcription: boolean;
  launch_on_system_startup: boolean;
  vocabulary: string[];
  action_triggers: ActionTrigger[];
  shortcuts: Shortcut[];
}

/**
 * AppConfigUpdateRequest for updating app config (partial updates supported)
 */
export interface AppConfigUpdateRequest {
  system_type?: string;
  device_type?: DeviceType;
  hotkeys?: string[];
  languages?: LanguageCode[];
  enhance_transcription?: boolean;
  launch_on_system_startup?: boolean;
  vocabulary?: string[] | null;
  action_triggers?: ActionTrigger[] | null;
  shortcuts?: Shortcut[] | null;
}

/**
 * AppConfig from Tauri Store (local storage, all fields optional)
 */
export interface TauriAppConfig {
  languages?: string[] | null;
  hotkeys?: string[] | null;
  enhance_transcription?: boolean | null;
  launch_on_system_startup?: boolean | null;
  vocabulary?: string[] | null;
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
  llm_enhancement_provider: string | null;
  llm_model: string | null;
  audio_file_url: string | null;
  audio_file_size: number | null;
  asr_provider: string;
  asr_model: string;
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
// Room Types
// ============================================================================

export interface RoomTranscriptSegment {
  id: string;
  segment_index: number;
  start_time: string;
  end_time: string;
  speaker_label: string;
  text: string;
}

export interface Room {
  id: string;
  created_by: string;
  updated_by: string;
  name: string;
  created_at: string;
  updated_at: string;
  speaker_map?: Record<string, string>;
  transcripts?: RoomTranscriptSegment[];
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
    | "rooms"
    | "notes";
  onNavigate: (
    page:
      | "home"
      | "transcripts"
      | "settings"
      | "vocabulary"
      | "actions"
      | "shortcuts"
      | "notes"
      | "rooms",
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

export interface ActionTrigger {
  id: string;
  trigger_phrase: string;
  is_active: boolean;
}

export interface ActionTriggerCreateRequest {
  trigger_phrase: string;
  is_active?: boolean;
}

export interface ActionTriggerUpdateRequest {
  trigger_phrase?: string;
  is_active?: boolean;
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
