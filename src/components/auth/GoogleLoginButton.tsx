import React, { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from '../../store/authStore';
import { exchangeGoogleAuthCode, refreshJWTToken, logout as backendLogout } from '../../lib/apiClient';
import './auth.css';

interface GoogleLoginButtonProps {
  onSuccess?: (user: any) => void;
  onError?: (error: string) => void;
}

export const GoogleLoginButton: React.FC<GoogleLoginButtonProps> = ({ 
  onSuccess, 
  onError 
}) => {
  const { setAuthData, clearAuth, setLoading, setError, user, isAuthenticated, tokens } = useAuthStore();
  const [loading, setLocalLoading] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isWaitingForCallback = useRef(false);

  const handleGoogleLogin = async () => {
    setLocalLoading(true);
    setLoading(true);
    setError(null);

    try {
      // Get client ID from environment
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

      if (!clientId) {
        throw new Error(
          'Google OAuth credentials not configured. ' +
          'Please set VITE_GOOGLE_CLIENT_ID in your .env file.'
        );
      }

      // Start OAuth flow with PKCE via Rust backend
      // This generates PKCE challenge/verifier, builds auth URL, and opens browser
      const pkceData = await invoke<{
        challenge: string;
        verifier: string;
        state: string;
        auth_url: string;
      }>('start_google_login', { clientId });

      console.log('PKCE challenge generated, browser opened:', pkceData);

      isWaitingForCallback.current = true;
      
      // Listen for OAuth callback from Rust backend
      const unlisten = await listen<{
        code: string;
        state: string;
        verifier: string;
      }>('google-oauth-callback', async (event) => {
        isWaitingForCallback.current = false;
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        unlisten(); // One-time listener

        try {
          const { code, state, verifier } = event.payload;
          console.log('Received OAuth callback:', { code, state, verifier });

          // Exchange authorization code + verifier for backend JWT tokens
          const redirectUri = 'http://127.0.0.1:8000'; // Match the redirect URI used in Rust
          const backendAuth = await exchangeGoogleAuthCode(
            code,
            state,
            verifier, // PKCE verifier
            redirectUri
          );

          console.log('Backend authentication successful:', backendAuth);

          // Store backend JWT tokens
          const authTokens = {
            access_token: backendAuth.access_token,
            refresh_token: backendAuth.refresh_token,
            expires_in: backendAuth.expires_in,
            expires_at: backendAuth.expires_in 
              ? Date.now() + backendAuth.expires_in * 1000 
              : undefined
          };

          const authUser = {
            email: backendAuth.user.email || '',
            name: backendAuth.user.name || '',
            picture: backendAuth.user.picture
          };

          setAuthData(authTokens, authUser);
          
          if (onSuccess) {
            onSuccess(backendAuth.user);
          }
        } catch (error: any) {
          const errorMessage = error?.message || 'Failed to exchange authorization code';
          console.error('Token exchange failed:', error);
          setError(errorMessage);
          
          if (onError) {
            onError(errorMessage);
          }
        } finally {
          setLocalLoading(false);
          setLoading(false);
        }
      });

      // Set a timeout to handle cases where user doesn't complete auth
      timeoutRef.current = setTimeout(() => {
        // If still waiting for callback after 5 minutes, assume user cancelled
        if (isWaitingForCallback.current) {
          isWaitingForCallback.current = false;
          setLocalLoading(false);
          setLoading(false);
          setError('Authentication timed out. Please try again.');
          if (onError) {
            onError('Authentication timed out');
          }
        }
      }, 5 * 60 * 1000); // 5 minutes

    } catch (error: any) {
      const errorMessage = error?.message || 'Google login failed';
      console.error('Google Login Failed:', error);
      setError(errorMessage);
      
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      // Logout from backend first
      await backendLogout();
      // Clear local auth
      clearAuth();
    } catch (error) {
      console.error('Logout Failed:', error);
      // Still clear local auth even if logout fails
      clearAuth();
    }
  };

  const handleRefresh = async () => {
    try {
      setLoading(true);
      
      // Get refresh token from store
      if (!tokens?.refresh_token) {
        throw new Error('No refresh token available');
      }

      // Refresh backend JWT token
      const refreshed = await refreshJWTToken(tokens.refresh_token);
      console.log('Token Refreshed:', refreshed);
      
      if (refreshed.access_token && user) {
        const authTokens = {
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token || tokens.refresh_token,
          expires_in: refreshed.expires_in,
          expires_at: refreshed.expires_in 
            ? Date.now() + refreshed.expires_in * 1000 
            : undefined
        };
        
        setAuthData(authTokens, user);
      }
    } catch (error: any) {
      console.error('Refresh Failed:', error);
      setError(error?.message || 'Failed to refresh token');
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated && user) {
    return (
      <div className="auth-user-info">
        <div className="auth-user-details">
          {user.picture && (
            <img 
              src={user.picture} 
              alt="Profile" 
              className="auth-user-avatar"
            />
          )}
          <div className="auth-user-text">
            <p className="auth-user-name">{user.name}</p>
            <p className="auth-user-email">{user.email}</p>
          </div>
        </div>
        <div className="auth-actions">
          <button 
            onClick={handleRefresh} 
            className="auth-button secondary"
            disabled={loading}
          >
            Refresh Token
          </button>
          <button 
            onClick={handleLogout} 
            className="auth-button secondary"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleGoogleLogin}
      disabled={loading}
      className="auth-button google-login"
    >
      {loading ? (
        <>
          <span className="auth-spinner">⏳</span>
          Signing in...
        </>
      ) : (
        <>
          <svg className="google-icon" viewBox="0 0 24 24" width="20" height="20">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Sign in with Google
        </>
      )}
    </button>
  );
};
