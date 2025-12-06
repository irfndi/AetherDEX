"use client";

import { useToast } from "@/hooks/use-toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]"
      role="alert"
      aria-live="assertive"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border bg-background p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full"
        >
          <div className="flex flex-col gap-1">
            {toast.title && <p className="text-sm font-semibold">{toast.title}</p>}
            {toast.description && (
              <p className="text-sm opacity-90">{toast.description}</p>
            )}
          </div>
          {toast.action}
          <button
            type="button"
            className="absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100"
            onClick={() => dismiss(toast.id)}
          >
            <span className="sr-only">Close notification</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
              role="img"
            >
              <title>Close</title>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
