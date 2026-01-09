/**
 * API Client for Lexi AI Backend
 *
 * Handles all HTTP requests to the backend server with authentication support.
 */

import { getDeviceInfo } from "./deviceInfo";
import { SystemType } from "./constants";
import { authStore } from "../store/authStore";
import {
  AUTH_ENDPOINTS,
  TRANSCRIPT_ENDPOINTS,
  USER_ENDPOINTS,
  ACTION_ENDPOINTS,
  getApiUrl,
} from "./apiEndpoints";
import type {
  ApiResponse,
  AuthResponse,
  Transcript,
  PaginatedTranscriptsResponse,
  AppConfig,
  AppConfigUpdateRequest,
  ActionHistory,
  PaginatedActionHistoryResponse,
  ActionTrigger,
  ActionTriggerCreateRequest,
  ActionTriggerUpdateRequest,
} from "../types";

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
    const device = await getDeviceInfo();

    const response = await fetch(getApiUrl(AUTH_ENDPOINTS.refresh), {
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
          // Default to 1 hour if expires_in not provided
          const expiresIn = data.expires_in || 3600;
          authStore.setAuthData(
            {
              ...authStore.tokens,
              access_token: data.access_token,
              refresh_token:
                data.refresh_token || authStore.tokens.refresh_token,
              expires_in: expiresIn,
              expires_at: Date.now() + expiresIn * 1000,
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
  const response = await fetch(getApiUrl(AUTH_ENDPOINTS.googleUrl), {
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
  const device = deviceInfo || (await getDeviceInfo());

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

  const response = await fetch(getApiUrl(AUTH_ENDPOINTS.googleCallback), {
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
  const response = await fetch(getApiUrl(AUTH_ENDPOINTS.google), {
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
  const device = deviceInfo || (await getDeviceInfo());

  const response = await fetch(getApiUrl(AUTH_ENDPOINTS.refresh), {
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
  const response = await authenticatedFetch(getApiUrl(AUTH_ENDPOINTS.me), {
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
  const response = await authenticatedFetch(getApiUrl(AUTH_ENDPOINTS.logout), {
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
  const response = await fetch(getApiUrl(AUTH_ENDPOINTS.storeOAuthVerifier), {
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
  const response = await fetch(getApiUrl(AUTH_ENDPOINTS.oauthVerifier(state)), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

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

// Transcript types are imported from ../types

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
    getApiUrl(TRANSCRIPT_ENDPOINTS.list(params.toString())),
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
    getApiUrl(TRANSCRIPT_ENDPOINTS.get(transcriptId)),
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
    getApiUrl(TRANSCRIPT_ENDPOINTS.delete(transcriptId)),
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

// App config types are imported from ../types

/**
 * Get current user's application configuration
 */
export async function getAppConfig(
  systemType: SystemType = SystemType.MAC,
): Promise<AppConfig> {
  const params = new URLSearchParams({ system_type: systemType });
  const response = await authenticatedFetch(
    getApiUrl(USER_ENDPOINTS.config(params.toString())),
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
    getApiUrl(USER_ENDPOINTS.config()),
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

// ============================================================================
// Action History Functions
// ============================================================================

/**
 * Get paginated action history
 */
export async function getActionHistory(
  page: number = 1,
  pageSize: number = 20,
  orderBy: string = "created_at",
  orderDirection: "asc" | "desc" = "desc",
): Promise<PaginatedActionHistoryResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    page_size: pageSize.toString(),
    order_by: orderBy,
    order_direction: orderDirection,
  });

  const response = await authenticatedFetch(
    getApiUrl(ACTION_ENDPOINTS.history(params.toString())),
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
        `Failed to get action history: ${response.status}`,
    );
  }

  const data: ApiResponse<PaginatedActionHistoryResponse> =
    await response.json();
  return (data.data || data) as PaginatedActionHistoryResponse;
}

/**
 * Delete an action history entry
 */
export async function deleteActionHistory(actionId: string): Promise<void> {
  const response = await authenticatedFetch(
    getApiUrl(ACTION_ENDPOINTS.deleteHistory(actionId)),
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
        `Failed to delete action history: ${response.status}`,
    );
  }
}

// ============================================================================
// Action Trigger Functions
// ============================================================================

/**
 * Get all action triggers for the current user from app config
 */
export async function getActionTriggers(
  systemType: SystemType = SystemType.MAC,
  includeInactive: boolean = false,
): Promise<ActionTrigger[]> {
  const params = new URLSearchParams({
    system_type: systemType,
  });
  if (includeInactive) {
    params.append("include_inactive", "true");
  }

  const response = await authenticatedFetch(
    getApiUrl(ACTION_ENDPOINTS.triggers(params.toString())),
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
        `Failed to get action triggers: ${response.status}`,
    );
  }

  const data: ApiResponse<ActionTrigger[]> = await response.json();
  return (data.data || data) as ActionTrigger[];
}

/**
 * Create a new action trigger in app config
 */
export async function createActionTrigger(
  request: ActionTriggerCreateRequest,
  systemType: SystemType = SystemType.MAC,
): Promise<ActionTrigger> {
  const params = new URLSearchParams({
    system_type: systemType,
  });

  const response = await authenticatedFetch(
    getApiUrl(`${ACTION_ENDPOINTS.createTrigger}?${params.toString()}`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      errorData.error ||
        errorData.detail ||
        `Failed to create action trigger: ${response.status}`,
    );
  }

  const data: ApiResponse<ActionTrigger> = await response.json();
  return (data.data || data) as ActionTrigger;
}

/**
 * Update an action trigger in app config
 */
export async function updateActionTrigger(
  triggerId: string,
  request: ActionTriggerUpdateRequest,
  systemType: SystemType = SystemType.MAC,
): Promise<ActionTrigger> {
  const params = new URLSearchParams({
    system_type: systemType,
  });

  const response = await authenticatedFetch(
    getApiUrl(
      `${ACTION_ENDPOINTS.updateTrigger(triggerId)}?${params.toString()}`,
    ),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(
      errorData.error ||
        errorData.detail ||
        `Failed to update action trigger: ${response.status}`,
    );
  }

  const data: ApiResponse<ActionTrigger> = await response.json();
  return (data.data || data) as ActionTrigger;
}

/**
 * Delete an action trigger from app config
 */
export async function deleteActionTrigger(
  triggerId: string,
  systemType: SystemType = SystemType.MAC,
): Promise<void> {
  const params = new URLSearchParams({
    system_type: systemType,
  });

  const response = await authenticatedFetch(
    getApiUrl(
      `${ACTION_ENDPOINTS.deleteTrigger(triggerId)}?${params.toString()}`,
    ),
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
        `Failed to delete action trigger: ${response.status}`,
    );
  }
}
