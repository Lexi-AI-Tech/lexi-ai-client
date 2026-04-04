"use client";

import { Toaster } from "sonner";

export function ToastProvider() {
  return (
    <Toaster
      position="top-center"
      theme="light"
      richColors={false}
      expand
      closeButton
      icons={{
        loading: <span className="toast-loading-spinner" aria-hidden />,
      }}
      toastOptions={{
        style: {
          fontSize: "14px",
          padding: "16px",
          borderRadius: "12px",
          boxShadow: "var(--lexi-shadow-md)",
          border: "1px solid var(--lexi-border)",
          background: "var(--lexi-surface-elevated)",
          color: "var(--lexi-text)",
          fontFamily: "var(--lexi-font-body)",
        },
        classNames: {
          toast: "sonner-toast",
          success: "sonner-toast-success",
          error: "sonner-toast-error",
          warning: "sonner-toast-warning",
          info: "sonner-toast-info",
        },
      }}
    />
  );
}
