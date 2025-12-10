import { MoonIcon, SunIcon } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { WalletConnect } from "@/components/features/wallet/WalletConnect";

interface HeaderProps {
  onWalletConnect: (address: string) => void;
}

export function Header({ onWalletConnect }: HeaderProps) {
  const { setTheme } = useTheme();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const router = useRouterState();

  const navLinks = [
    { to: "/trade/swap", label: "Swap" },
    { to: "/trade/limit", label: "Limit" },
    { to: "/trade/send", label: "Send" },
    { to: "/trade/buy", label: "Buy" },
    { to: "/trade/liquidity", label: "Pool" },
  ];

  return (
    <header className="fixed top-0 left-0 w-full h-16 glass z-50 transition-all duration-300">
      <div className="container max-w-7xl h-full flex items-center justify-between px-6">
        <Link to="/" className="font-heading font-bold text-2xl tracking-tighter text-gradient">
          AetherDEX
        </Link>

        <nav className="hidden md:flex items-center gap-1 bg-black/20 p-1 rounded-full border border-white/5 backdrop-blur-sm">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              activeProps={{ className: "bg-white/10 text-white shadow-sm" }}
              inactiveProps={{ className: "text-muted-foreground hover:text-white hover:bg-white/5" }}
              className="px-5 py-2 rounded-full text-sm font-medium transition-all duration-200"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/5">
                <SunIcon className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <MoonIcon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass-card border-white/10">
              <DropdownMenuItem onClick={() => setTheme("light")}>Light</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>Dark</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>System</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <WalletConnect onConnected={(address: string) => onWalletConnect(address)} />
        </div>
      </div>
    </header>
  );
}
