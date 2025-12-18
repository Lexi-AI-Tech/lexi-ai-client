/**
 * OAuth Callback Handler Component
 * 
 * Handles the OAuth callback from Google, extracts the authorization code and state,
 * retrieves the PKCE verifier from the Rust backend, and exchanges the code for tokens.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { exchangeGoogleAuthCode } from '../../lib/apiClient';
import { getDeviceInfo } from '../../lib/deviceInfo';
import { useAuthStore } from '../../store/authStore';
import './auth.css';

export const OAuthCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setAuthData, setError, setLoading } = useAuthStore();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        setLoading(true);
        
        // Extract code and state from URL
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const error = searchParams.get('error');

        // Check for OAuth error
        if (error) {
          throw new Error(`OAuth error: ${error}`);
        }

        if (!code) {
          throw new Error('Authorization code is missing');
        }

        if (!state) {
          throw new Error('State parameter is missing');
        }

        console.log('OAuth callback received:', { code: code.substring(0, 10) + '...', state });

        // Get PKCE verifier from Rust backend using the state
        const verifier = await invoke<string>('get_pkce_verifier', { oauthState: state });
        
        if (!verifier) {
          throw new Error('PKCE verifier not found. The OAuth flow may have expired. Please try again.');
        }

        console.log('Retrieved PKCE verifier from backend');

        // Get redirect URI (should match what was used in the OAuth request)
        const redirectUri = import.meta.env.VITE_GOOGLE_REDIRECT_URI || 'http://localhost:5173/auth/google/callback';
        
        // Get device info for session tracking
        const deviceInfo = getDeviceInfo();
        
        // Exchange authorization code for backend JWT tokens
        const backendAuth = await exchangeGoogleAuthCode(
          code,
          state,
          verifier,
          redirectUri,
          deviceInfo
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
        setStatus('success');

        // Redirect to home after a short delay
        setTimeout(() => {
          navigate('/');
        }, 2000);

      } catch (error: any) {
        const errorMsg = error?.message || 'Failed to complete authentication';
        console.error('OAuth callback error:', error);
        setErrorMessage(errorMsg);
        setError(errorMsg);
        setStatus('error');
      } finally {
        setLoading(false);
      }
    };

    handleCallback();
  }, [searchParams, navigate, setAuthData, setError, setLoading]);

  if (status === 'success') {
    return (
      <div className="oauth-callback-container">
        <div className="oauth-callback-content">
          <div className="oauth-success-icon">✓</div>
          <h1>Authentication Successful!</h1>
          <p>You have been successfully logged in.</p>
          <p className="oauth-redirect-message">Redirecting to the app...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="oauth-callback-container">
        <div className="oauth-callback-content">
          <div className="oauth-error-icon">✗</div>
          <h1>Authentication Failed</h1>
          <p>{errorMessage || 'An error occurred during authentication.'}</p>
          <button 
            onClick={() => navigate('/')} 
            className="auth-button"
          >
            Return to App
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="oauth-callback-container">
      <div className="oauth-callback-content">
        <div className="oauth-spinner">⏳</div>
        <h1>Completing Authentication...</h1>
        <p>Please wait while we complete your login.</p>
      </div>
    </div>
  );
};

