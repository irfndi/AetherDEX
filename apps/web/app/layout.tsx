import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "Aether DEX",
  description: "Decentralized Exchange Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="font-sans" style={{ backgroundColor: "lightblue" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
