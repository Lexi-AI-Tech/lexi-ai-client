/**
 * Common Type Definitions
 *
 * All TypeScript interfaces and types used across the application.
 * This file serves as the single source of truth for type definitions.
 */

import { SystemType, LanguageCode } from "../lib/constants";

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
    email: string;
    name: string;
    picture?: string;
    id?: string;
  };
  expires_in?: number;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface AuthUser {
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
}

// ============================================================================
// App Configuration Types
// ============================================================================

export interface VocabularyItem {
  value: string;
  is_system_generated: boolean;
  hidden: boolean;
}

/**
 * AppConfig from server API (complete config with all fields)
 */
export interface AppConfig {
  system_type: SystemType;
  hotkeys: string[];
  languages: LanguageCode[];
  enhance_transcription: boolean;
  launch_on_system_startup: boolean;
  vocabulary?: VocabularyItem[] | null;
}

/**
 * AppConfigUpdateRequest for updating app config (partial updates supported)
 */
export interface AppConfigUpdateRequest {
  system_type?: SystemType;
  hotkeys?: string[];
  languages?: LanguageCode[];
  enhance_transcription?: boolean;
  launch_on_system_startup?: boolean;
  vocabulary?: VocabularyItem[] | null;
}

/**
 * AppConfig from Tauri Store (local storage, all fields optional)
 */
export interface TauriAppConfig {
  languages?: string[] | null;
  hotkeys?: string[] | null;
  enhance_transcription?: boolean | null;
  launch_on_system_startup?: boolean | null;
  vocabulary?: VocabularyItem[] | null;
}

// ============================================================================
// Transcript Types
// ============================================================================

export interface Transcript {
  id: number;
  user_id: number;
  original_text: string | null;
  original_text_word_count: number;
  original_text_character_count: number;
  is_enhanced: boolean;
  enhanced_text: string | null;
  enhanced_text_word_count: number | null;
  enhanced_text_character_count: number | null;
  audio_file_url: string | null;
  audio_file_size: number | null;
  provider: string | null;
  asr_model: string | null;
  status: string;
  error_message: string | null;
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
// Device & System Types
// ============================================================================

export interface DeviceInfo {
  device_name: string;
  device_type: string;
  system_type: "mac" | "windows" | "unknown";
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
  | "fn-key-test"
  | "microphone-test"
  | "home";

export interface OnboardingState {
  currentStep: OnboardingStep;
  isCompleted: boolean;
  setStep: (step: OnboardingStep) => void;
  nextStep: () => void;
  previousStep: () => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
}

// ============================================================================
// Component Props Types
// ============================================================================

export interface GoogleLoginButtonProps {
  onSuccess?: (user: any) => void;
  onError?: (error: string) => void;
}

export interface SidebarProps {
  currentPage: "transcripts" | "settings" | "vocabulary" | "actions" | "shortcuts";
  onNavigate: (page: "transcripts" | "settings" | "vocabulary" | "actions" | "shortcuts") => void;
}

// ============================================================================
// Action Types
// ============================================================================

export interface ActionHistory {
  id: string;
  user_id: string;
  action_command: string;
  app_name: string | null;
  selected_text: string | null;
  action_type: string;
  action_result: string | null;
  metadata: Record<string, any> | null;
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
  user_id: string;
  trigger_phrase: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActionTriggerCreateRequest {
  trigger_phrase: string;
  is_active?: boolean;
}

export interface ActionTriggerUpdateRequest {
  trigger_phrase?: string;
  is_active?: boolean;
}

export interface PermissionState {
  granted: boolean;
  checking: boolean;
}
