"use client";

import * as React from "react";

const TOAST_LIMIT = 1;

export type ToastProps = {
  id: string;
  title?: string;
  description?: string;
  action?: React.ReactNode;
};

const toastStore = {
  toasts: [] as ToastProps[],
  listeners: new Set<() => void>(),

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  notify(props: Omit<ToastProps, "id">) {
    const id = crypto.randomUUID();

    if (this.toasts.length >= TOAST_LIMIT) {
      this.toasts.pop();
    }

    this.toasts = [{ ...props, id }, ...this.toasts];
    for (const listener of Array.from(this.listeners)) listener();
    return id;
  },

  dismiss(toastId?: string) {
    this.toasts = this.toasts.filter((t) => t.id !== toastId);
    for (const listener of Array.from(this.listeners)) listener();
  },

  getToasts() {
    return this.toasts;
  },
};

export function useToast() {
  const [toasts, setToasts] = React.useState(toastStore.getToasts());

  React.useEffect(() => {
    const unsubscribe = toastStore.subscribe(() => {
      setToasts(toastStore.getToasts());
    });
    return () => void unsubscribe();
  }, []);

  return {
    toast: React.useCallback((props: Omit<ToastProps, "id">) => toastStore.notify(props), []),
    dismiss: React.useCallback((toastId?: string) => toastStore.dismiss(toastId), []),
    toasts,
  };
}
