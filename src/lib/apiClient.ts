/**
 * API Client for Lexi AI Backend
 *
 * Handles all HTTP requests to the backend server with authentication support.
 */

import { authStore } from "../store/authStore";

// Use localhost in development, production URL in production builds
// Can be overridden with VITE_API_BASE_URL environment variable
const API_BASE_URL =
  import.meta.env.MODE === "development"
    ? "http://localhost:1230"
    : "https://lexi-ai-server.onrender.com";

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

/**
 * Get the current access token from auth store
 */
function getAccessToken(): string | null {
  try {
    return authStore.tokens?.access_token || null;
  } catch (e) {
    console.error("Failed to get access token:", e);
  }
  return null;
}

/**
 * Get the refresh token from auth store
 */
function getRefreshToken(): string | null {
  try {
    return authStore.tokens?.refresh_token || null;
  } catch (e) {
    console.error("Failed to get refresh token:", e);
  }
  return null;
}

/**
 * Refresh the access token using the backend endpoint
 */
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  try {
    // Import device info utility
    const { getDeviceInfo } = await import("./deviceInfo");
    const device = getDeviceInfo();

    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
        device_name: device.device_name,
        device_type: device.device_type,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data: ApiResponse<AuthResponse> = await response.json();

    if (data.access_token) {
      // Update tokens in auth store
      try {
        if (authStore.tokens && authStore.user) {
          authStore.setAuthData(
            {
              ...authStore.tokens,
              access_token: data.access_token,
              refresh_token:
                data.refresh_token || authStore.tokens.refresh_token,
              expires_in: data.expires_in,
              expires_at: data.expires_in
                ? Date.now() + data.expires_in * 1000
                : authStore.tokens.expires_at,
            },
            authStore.user,
          );
        }
      } catch (e) {
        console.error("Failed to update tokens:", e);
      }

      return data.access_token;
    }

    return null;
  } catch (error) {
    console.error("Token refresh error:", error);
    return null;
  }
}

/**
 * Make an authenticated fetch request with automatic token refresh
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  // Proactively refresh token if it's expiring soon
  try {
    await authStore.refreshTokenIfNeeded();
  } catch (e) {
    // Ignore errors in proactive refresh, will handle on 401
    console.debug("Proactive refresh check failed:", e);
  }

  let token = getAccessToken();

  // Add authorization header if token exists
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response = await fetch(url, {
    ...options,
    headers,
  });

  // If unauthorized, try to refresh token and retry once
  if (response.status === 401 && token) {
    console.log("🔄 Received 401, attempting token refresh...");
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      response = await fetch(url, {
        ...options,
        headers,
      });
    } else {
      // Refresh failed, clear auth
      authStore.clearAuth();
      // Dispatch event to notify app of auth failure
      window.dispatchEvent(new CustomEvent("auth-expired"));
    }
  }

  return response;
}

/**
 * Get Google OAuth URL from backend
 * The backend should handle OAuth flow securely with client secret
 */
export async function getGoogleOAuthUrl(): Promise<{
  url: string;
  state?: string;
}> {
  const response = await fetch(`${API_BASE_URL}/api/auth/google/url`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    // FastAPI returns errors in 'detail' field, but some APIs use 'error'
    throw new Error(
      errorData.detail ||
        errorData.error ||
        `Failed to get OAuth URL: ${response.status}`,
    );
  }

  const data: ApiResponse<{ url: string; state?: string }> =
    await response.json();

  if (!data.url) {
    throw new Error("Invalid response from authentication server");
  }

  return {
    url: data.url,
    state: data.state,
  };
}

/**
 * Exchange Google OAuth authorization code for backend JWT tokens
 * This is called after user authenticates and backend receives the callback
 * Supports both PKCE and traditional OAuth flows
 */
export async function exchangeGoogleAuthCode(
  code: string,
  state?: string,
  codeVerifier?: string,
  redirectUri?: string,
  deviceInfo?: { device_name?: string; device_type?: string },
): Promise<AuthResponse> {
  // Import device info utility
  const { getDeviceInfo } = await import("./deviceInfo");
  const device = deviceInfo || getDeviceInfo();

  // Ensure code_verifier is always sent if provided (required for PKCE)
  const requestBody: any = {
    code,
    state,
    device_name: device.device_name,
    device_type: device.device_type,
  };

  // Always include code_verifier if it's provided (check for undefined/null, not falsy)
  if (codeVerifier !== undefined && codeVerifier !== null) {
    requestBody.code_verifier = codeVerifier;
  }
  if (redirectUri) {
    requestBody.redirect_uri = redirectUri;
  }

  console.log("Sending token exchange request:", {
    hasCode: !!code,
    codeLength: code?.length,
    hasVerifier: codeVerifier !== undefined && codeVerifier !== null,
    verifierLength: codeVerifier?.length,
    verifierPreview: codeVerifier
      ? `${codeVerifier.substring(0, 20)}...`
      : "undefined",
    requestBodyKeys: Object.keys(requestBody),
  });

  // Log the actual request body (without sensitive data)
  console.log("Request body (sanitized):", {
    ...requestBody,
    code_verifier: requestBody.code_verifier
      ? `${requestBody.code_verifier.substring(0, 20)}... (length: ${requestBody.code_verifier.length})`
      : "missing",
  });

  const response = await fetch(`${API_BASE_URL}/api/auth/google/callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    // FastAPI returns errors in 'detail' field, but some APIs use 'error'
    const errorMessage =
      errorData.detail ||
      errorData.error ||
      `Authentication failed: ${response.status}`;
    console.error("Token exchange failed:", errorMessage, errorData);
    throw new Error(errorMessage);
  }

  const data: ApiResponse<AuthResponse> = await response.json();

  if (!data.access_token || !data.user) {
    throw new Error("Invalid response from authentication server");
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || "",
    user: data.user,
    expires_in: data.expires_in,
  };
}

/**
 * Exchange Google OAuth tokens for backend JWT tokens
 * @deprecated Use exchangeGoogleAuthCode instead for secure OAuth flow
 */
export async function exchangeGoogleTokens(googleTokens: {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id_token: googleTokens.id_token,
      access_token: googleTokens.access_token,
      refresh_token: googleTokens.refresh_token,
      expires_in: googleTokens.expires_in,
    }),
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      errorData.error || `Authentication failed: ${response.status}`,
    );
  }

  const data: ApiResponse<AuthResponse> = await response.json();

  if (!data.access_token || !data.user) {
    throw new Error("Invalid response from authentication server");
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || "",
    user: data.user,
    expires_in: data.expires_in,
  };
}

/**
 * Refresh JWT tokens using the backend endpoint
 */
export async function refreshJWTToken(
  refreshToken: string,
  deviceInfo?: { device_name?: string; device_type?: string },
): Promise<AuthResponse> {
  // Import device info utility
  const { getDeviceInfo } = await import("./deviceInfo");
  const device = deviceInfo || getDeviceInfo();

  const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refresh_token: refreshToken,
      device_name: device.device_name,
      device_type: device.device_type,
    }),
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      errorData.error || `Token refresh failed: ${response.status}`,
    );
  }

  const data: ApiResponse<AuthResponse> = await response.json();

  if (!data.access_token) {
    throw new Error("Invalid response from token refresh");
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    user: data.user || ({} as any),
    expires_in: data.expires_in,
  };
}

/**
 * Get current user from backend
 */
export async function getCurrentUser(): Promise<AuthResponse["user"]> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/auth/me`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Failed to get user: ${response.status}`);
  }

  const data: ApiResponse<AuthResponse["user"]> = await response.json();
  return (data.data || data) as AuthResponse["user"];
}

/**
 * Logout from backend
 */
export async function logout(): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/auth/logout`, {
    method: "POST",
  });

  if (!response.ok) {
    // Even if logout fails on backend, we'll clear local auth
    console.warn("Backend logout failed, clearing local auth anyway");
  }
}

/**
 * Store PKCE verifier temporarily on backend (Redis)
 */
export async function storePkceVerifier(
  state: string,
  verifier: string,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/auth/oauth/verifier`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state,
      verifier,
    }),
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(
      errorData.detail ||
        errorData.error ||
        `Failed to store verifier: ${response.status}`,
    );
  }
}

/**
 * Retrieve PKCE verifier from backend (Redis) using state
 */
export async function getPkceVerifier(state: string): Promise<string> {
  const response = await fetch(
    `${API_BASE_URL}/api/auth/oauth/verifier/${encodeURIComponent(state)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(
      errorData.detail ||
        errorData.error ||
        `Failed to retrieve verifier: ${response.status}`,
    );
  }

  const data = await response.json();
  // Handle both direct response and wrapped response
  if (data.verifier) {
    return data.verifier;
  } else if (data.data && data.data.verifier) {
    return data.data.verifier;
  } else {
    throw new Error("Invalid response format from verifier endpoint");
  }
}

/**
 * Check OAuth authentication status for a given state.
 * Polls the backend to see if authentication completed.
 */
export async function checkOAuthStatus(state: string): Promise<{
  status: "pending" | "completed";
  access_token?: string;
  refresh_token?: string;
  user?: {
    email: string;
    name: string;
    picture?: string;
  };
  expires_in?: number;
}> {
  const response = await fetch(
    `${API_BASE_URL}/api/auth/oauth/status/${encodeURIComponent(state)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(
      errorData.detail ||
        errorData.error ||
        `Failed to check OAuth status: ${response.status}`,
    );
  }

  const data = await response.json();
  return data;
}

/**
 * Transcript types
 */
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

/**
 * Get paginated list of transcripts
 */
export async function getTranscripts(
  page: number = 1,
  pageSize: number = 20,
  status?: string,
  orderBy: string = "created_at",
  orderDirection: "asc" | "desc" = "desc",
): Promise<PaginatedTranscriptsResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    page_size: pageSize.toString(),
    order_by: orderBy,
    order_direction: orderDirection,
  });

  if (status) {
    params.append("status", status);
  }

  const response = await authenticatedFetch(
    `${API_BASE_URL}/api/transcription/transcripts?${params.toString()}`,
    {
      method: "GET",
    },
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      errorData.error ||
        errorData.detail ||
        `Failed to get transcripts: ${response.status}`,
    );
  }

  const data: ApiResponse<PaginatedTranscriptsResponse> = await response.json();
  return (data.data || data) as PaginatedTranscriptsResponse;
}

/**
 * Get a specific transcript by ID
 */
export async function getTranscript(transcriptId: number): Promise<Transcript> {
  const response = await authenticatedFetch(
    `${API_BASE_URL}/api/transcription/transcripts/${transcriptId}`,
    {
      method: "GET",
    },
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      errorData.error ||
        errorData.detail ||
        `Failed to get transcript: ${response.status}`,
    );
  }

  const data: ApiResponse<Transcript> = await response.json();
  return (data.data || data) as Transcript;
}

/**
 * Delete a transcript by ID
 */
export async function deleteTranscript(transcriptId: number): Promise<void> {
  const response = await authenticatedFetch(
    `${API_BASE_URL}/api/transcription/transcripts/${transcriptId}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      errorData.error ||
        errorData.detail ||
        `Failed to delete transcript: ${response.status}`,
    );
  }
}

/**
 * App config types
 */
export interface AppConfig {
  system_type: string;
  hotkey: string;
  language: string;
  enhance_transcription: boolean;
  transcribe_with_cursor_context: boolean;
}

export interface AppConfigUpdateRequest {
  system_type?: string; // 'mac' or 'windows'
  hotkey?: string;
  language?: string;
  enhance_transcription?: boolean;
  transcribe_with_cursor_context?: boolean;
}

/**
 * Get current user's application configuration
 */
export async function getAppConfig(
  systemType: "mac" | "windows" = "mac",
): Promise<AppConfig> {
  const params = new URLSearchParams({ system_type: systemType });
  const response = await authenticatedFetch(
    `${API_BASE_URL}/api/users/me/config?${params.toString()}`,
    {
      method: "GET",
    },
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      errorData.error ||
        errorData.detail ||
        `Failed to get app config: ${response.status}`,
    );
  }

  const data: ApiResponse<AppConfig> = await response.json();
  return (data.data || data) as AppConfig;
}

/**
 * Update current user's application configuration
 */
export async function updateAppConfig(
  config: AppConfigUpdateRequest,
): Promise<AppConfig> {
  const response = await authenticatedFetch(
    `${API_BASE_URL}/api/users/me/config`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    },
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      errorData.error ||
        errorData.detail ||
        `Failed to update app config: ${response.status}`,
    );
  }

  const data: ApiResponse<AppConfig> = await response.json();
  return (data.data || data) as AppConfig;
}
