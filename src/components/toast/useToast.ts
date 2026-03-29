import { useMemo } from "react";
import { toast } from "sonner";

import { formatUserFacingApiErrorFromUnknown } from "../../utils/userFacingApiError";

export interface ToastOptions {
  duration?: number;
  description?: string;
}

export function useToast() {
  // Stable identity across renders so useCallback(..., [toast]) does not churn.
  return useMemo(
    () => ({
      success: (message: string, options?: ToastOptions) => {
        toast.success(message, {
          duration: options?.duration ?? 3000,
          description: options?.description,
        });
      },
      error: (message: unknown, options?: ToastOptions) => {
        const text = formatUserFacingApiErrorFromUnknown(message);
        toast.error(text, {
          duration: options?.duration ?? 4000,
          description: options?.description,
        });
      },
      info: (message: string, options?: ToastOptions) => {
        toast.info(message, {
          duration: options?.duration ?? 3000,
          description: options?.description,
        });
      },
      warning: (message: string, options?: ToastOptions) => {
        toast.warning(message, {
          duration: options?.duration ?? 3500,
          description: options?.description,
        });
      },
      loading: (message: string) => {
        return toast.loading(message);
      },
      dismiss: (toastId?: string | number) => {
        toast.dismiss(toastId);
      },
      promise: <T>(
        promise: Promise<T>,
        messages: {
          loading: string;
          success: string;
          error: string;
        },
      ) => {
        return toast.promise(promise, {
          loading: messages.loading,
          success: messages.success,
          error: messages.error,
        });
      },
    }),
    [],
  );
}
