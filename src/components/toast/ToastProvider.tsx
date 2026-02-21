'use client';

import { Toaster } from 'sonner';

export function ToastProvider() {
  return (
    <Toaster
      position="top-center"
      theme="light"
      richColors
      expand
      closeButton
      toastOptions={{
        style: {
          fontSize: '14px',
          padding: '16px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          border: '1px solid rgba(0, 0, 0, 0.1)',
        },
        classNames: {
          toast: 'sonner-toast',
          success: 'sonner-toast-success',
          error: 'sonner-toast-error',
          warning: 'sonner-toast-warning',
          info: 'sonner-toast-info',
        },
      }}
    />
  );
}
