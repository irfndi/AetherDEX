"use client";

import React, { useEffect, useRef } from "react";
import styles from "./BackgroundTokens.module.css";

const tokens = [
  "ETH", "BTC", "USDT", "BNB", "XRP", "ADA", "DOGE", "SOL", "DOT", "MATIC",
  "LTC", "TRX", "SHIB", "AVAX", "UNI", "LINK", "XLM", "XMR", "ETC", "ICP",
  "FIL", "VET", "EGLD", "AAVE", "EOS", "THETA", "XTZ", "NEO", "BSV", "ZEC"
];

export const BackgroundTokens = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log("BackgroundTokens useEffect running");
    const container = containerRef.current;
    if (!container) return;

    // Initial positions and styles for each element
    const elements = Array.from(container.children) as HTMLElement[];
    for (const element of elements) {
      // Set initial position
      const x = Math.random() * 90 + 5; // Keep within 5-95% to avoid edge clipping
      const y = Math.random() * 90 + 5;
      element.style.transform = `translate(${x}vw, ${y}vh)`;
      
      // Set color with animation
      const hue = Math.random() * 360;
      element.style.backgroundColor = `hsl(${hue}deg, 100%, 50%)`;
      element.style.filter = `saturate(${Math.random() * 0.5 + 0.5})`;
      
      // Randomize animation properties
      const duration = 2 + Math.random() * 2;
      const delay = Math.random() * -2;
      element.style.transition = `
        transform ${duration}s cubic-bezier(0.4, 0, 0.2, 1),
        filter 2s ease-in-out
      `;
      element.style.animationDelay = `${delay}s`;
    }

    const animate = () => {
      for (const element of elements) {
        const x = Math.random() * 90 + 5;
        const y = Math.random() * 90 + 5;
        const scale = 0.8 + Math.random() * 0.4;
        element.style.transform = `translate(${x}vw, ${y}vh) scale(${scale})`;
        element.style.filter = `saturate(${Math.random() * 0.5 + 0.5})`;
      }
    };

    // Initial animation
    animate();

    // Set up interval for continuous animation
    const intervalId = setInterval(animate, 4000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={styles.container}
    >
      {tokens.map((token) => (
        <div
          key={token}
          className={styles.token}
          style={{ 
            backgroundColor: `hsl(${Math.random() * 360}deg, 100%, 50%)`,
          }}
        />
      ))}
    </div>
  );
};
