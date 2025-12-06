import { type ClassValue, clsx } from "clsx";
import { useEffect, useLayoutEffect } from "react"; // Import useEffect and useLayoutEffect
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const useIsomorphicLayoutEffect = // Placeholder implementation for useIsomorphicLayoutEffect
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function generateToastId() {
  // Placeholder implementation for generateToastId
  return Math.random().toString(36).substring(2);
}
