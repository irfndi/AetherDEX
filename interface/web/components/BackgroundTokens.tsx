"use client";

import React, { useEffect, useRef, useState } from "react";

const tokens = [
  "ETH",
  "BTC",
  "USDT",
  "BNB",
  "XRP",
  "ADA",
  "DOGE",
  "SOL",
  "DOT",
  "MATIC",
  "LTC",
  "TRX",
  "SHIB",
  "AVAX",
  "UNI",
  "LINK",
  "XLM",
  "XMR",
  "ETC",
  "ICP",
  "FIL",
  "VET",
  "EGLD",
  "AAVE",
  "EOS",
  "THETA",
  "XTZ",
  "NEO",
  "BSV",
  "ZEC",
];

export const BackgroundTokens = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let animationFrameId = requestAnimationFrame(animate); // Changed const to let

    function animate() {
      if (!container) return; // Added null check for container

      const elements = Array.from(container.children) as HTMLElement[]
      for (const element of elements) { // Replaced forEach with for...of
        const x = Math.random() * 100
        const y = Math.random() * 100
        const duration = Math.random() * 1 + 1
        const delay = Math.random() * 5
        const size = Math.random() * 1.5 + 1.5

        element.style.setProperty("--x", `${x}%`)
        element.style.setProperty("--y", `${y}%`)
        element.style.setProperty("--animation-duration", `${duration}s`)
        element.style.setProperty("--animation-delay", `${delay}s`)
        element.style.setProperty("--scale", `${size}`)
      }

      animationFrameId = requestAnimationFrame(animate)
    }

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <div ref={containerRef} className="fixed inset-0 pointer-events-none overflow-hidden">
      {tokens.map((token) => ( // Removed index 'i'
        <div
          key={token} // Using token as key
          className="absolute w-10 h-10 rounded-full opacity-30 blur-sm"
          style={{
            backgroundColor: `hsl(${Math.random() * 360}deg, 100%, 50%)`,
          }}
        />
      ))}
    </div>
  );
};
