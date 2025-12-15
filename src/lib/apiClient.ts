/**
 * API Client for Lexi AI Backend
 * 
 * Handles all HTTP requests to the backend server with authentication support.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://lexi-ai-server.onrender.com';

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
 * Get the current access token from localStorage
 */
function getAccessToken(): string | null {
  try {
    const stored = localStorage.getItem('lexi-auth');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.tokens?.access_token || null;
    }
  } catch (e) {
    console.error('Failed to get access token:', e);
  }
  return null;
}

/**
 * Get the refresh token from localStorage
 */
function getRefreshToken(): string | null {
  try {
    const stored = localStorage.getItem('lexi-auth');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.tokens?.refresh_token || null;
    }
  } catch (e) {
    console.error('Failed to get refresh token:', e);
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
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data: ApiResponse<AuthResponse> = await response.json();
    
    if (data.access_token) {
      // Update stored tokens
      try {
        const stored = localStorage.getItem('lexi-auth');
        if (stored) {
          const parsed = JSON.parse(stored);
          parsed.tokens = {
            ...parsed.tokens,
            access_token: data.access_token,
            refresh_token: data.refresh_token || parsed.tokens.refresh_token,
            expires_in: data.expires_in,
            expires_at: data.expires_in 
              ? Date.now() + data.expires_in * 1000 
              : parsed.tokens.expires_at,
          };
          localStorage.setItem('lexi-auth', JSON.stringify(parsed));
        }
      } catch (e) {
        console.error('Failed to update tokens:', e);
      }
      
      return data.access_token;
    }
    
    return null;
  } catch (error) {
    console.error('Token refresh error:', error);
    return null;
  }
}

/**
 * Make an authenticated fetch request with automatic token refresh
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getAccessToken();
  
  // Add authorization header if token exists
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response = await fetch(url, {
    ...options,
    headers,
  });

  // If unauthorized, try to refresh token and retry once
  if (response.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(url, {
        ...options,
        headers,
      });
    } else {
      // Refresh failed, clear auth
      localStorage.removeItem('lexi-auth');
      // Dispatch event to notify app of auth failure
      window.dispatchEvent(new CustomEvent('auth-expired'));
    }
  }

  return response;
}

/**
 * Get Google OAuth URL from backend
 * The backend should handle OAuth flow securely with client secret
 */
export async function getGoogleOAuthUrl(): Promise<{ url: string; state?: string }> {
  const response = await fetch(`${API_BASE_URL}/api/auth/google/url`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Failed to get OAuth URL: ${response.status}`);
  }

  const data: ApiResponse<{ url: string; state?: string }> = await response.json();
  
  if (!data.url) {
    throw new Error('Invalid response from authentication server');
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
  redirectUri?: string
): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/google/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      state,
      code_verifier: codeVerifier, // PKCE verifier
      redirect_uri: redirectUri,   // Redirect URI used in auth request
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Authentication failed: ${response.status}`);
  }

  const data: ApiResponse<AuthResponse> = await response.json();
  
  if (!data.access_token || !data.user) {
    throw new Error('Invalid response from authentication server');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
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
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id_token: googleTokens.id_token,
      access_token: googleTokens.access_token,
      refresh_token: googleTokens.refresh_token,
      expires_in: googleTokens.expires_in,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Authentication failed: ${response.status}`);
  }

  const data: ApiResponse<AuthResponse> = await response.json();
  
  if (!data.access_token || !data.user) {
    throw new Error('Invalid response from authentication server');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    user: data.user,
    expires_in: data.expires_in,
  };
}

/**
 * Refresh JWT tokens using the backend endpoint
 */
export async function refreshJWTToken(refreshToken: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Token refresh failed: ${response.status}`);
  }

  const data: ApiResponse<AuthResponse> = await response.json();
  
  if (!data.access_token) {
    throw new Error('Invalid response from token refresh');
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    user: data.user || {} as any,
    expires_in: data.expires_in,
  };
}

/**
 * Get current user from backend
 */
export async function getCurrentUser(): Promise<AuthResponse['user']> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/auth/me`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to get user: ${response.status}`);
  }

  const data: ApiResponse<AuthResponse['user']> = await response.json();
  return (data.data || data) as AuthResponse['user'];
}

/**
 * Logout from backend
 */
export async function logout(): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/auth/logout`, {
    method: 'POST',
  });

  if (!response.ok) {
    // Even if logout fails on backend, we'll clear local auth
    console.warn('Backend logout failed, clearing local auth anyway');
  }
}
