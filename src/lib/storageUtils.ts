/**
 * Storage Utilities
 * 
 * Helper functions for managing localStorage
 */

/**
 * Clear all Lexi AI related localStorage data
 */
export function clearAllStorage(): void {
  try {
    localStorage.removeItem('lexi-auth');
    localStorage.removeItem('lexi-onboarding');
    console.log('✅ All localStorage cleared');
  } catch (e) {
    console.error('Failed to clear localStorage:', e);
    throw e;
  }
}

/**
 * Clear only authentication data
 */
export function clearAuthStorage(): void {
  try {
    localStorage.removeItem('lexi-auth');
    console.log('✅ Auth storage cleared');
  } catch (e) {
    console.error('Failed to clear auth storage:', e);
    throw e;
  }
}

/**
 * Clear only onboarding data
 */
export function clearOnboardingStorage(): void {
  try {
    localStorage.removeItem('lexi-onboarding');
    console.log('✅ Onboarding storage cleared');
  } catch (e) {
    console.error('Failed to clear onboarding storage:', e);
    throw e;
  }
}

/**
 * Get all Lexi AI storage keys and their values (for debugging)
 */
export function getAllStorage(): Record<string, any> {
  const storage: Record<string, any> = {};
  
  try {
    const auth = localStorage.getItem('lexi-auth');
    if (auth) {
      storage['lexi-auth'] = JSON.parse(auth);
    }
    
    const onboarding = localStorage.getItem('lexi-onboarding');
    if (onboarding) {
      storage['lexi-onboarding'] = JSON.parse(onboarding);
    }
  } catch (e) {
    console.error('Failed to read storage:', e);
  }
  
  return storage;
}
