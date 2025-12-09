"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { WalletConnect } from "@/components/features/wallet/WalletConnect";
import { useToast } from "@/hooks/use-toast";

interface HeaderProps {
  onWalletConnect: (address: string) => void;
}

export function Header({ onWalletConnect }: HeaderProps) {
  const { setTheme } = useTheme();
  const { toast } = useToast();

  return (
    <header className="fixed top-0 left-0 w-full h-16 bg-background/90 backdrop-blur-md z-50 border-b border-border">
      <div className="container max-w-7xl h-full flex items-center justify-between">
        <Link href="/" className="font-bold text-xl">
          Aether
        </Link>
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                Trade
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuItem
                onClick={() =>
                  toast({ title: "Coming Soon", description: "Buy feature is not available yet." })
                }
              >
                Buy
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast({ title: "Coming Soon", description: "Sell feature is not available yet." })
                }
              >
                Sell
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast({ title: "Coming Soon", description: "Swap feature is not available yet." })
                }
              >
                Swap
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast({
                    title: "Coming Soon",
                    description: "Limit feature is not available yet.",
                  })
                }
              >
                Limit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast({ title: "Coming Soon", description: "Send feature is not available yet." })
                }
              >
                Send
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            onClick={() =>
              toast({ title: "Coming Soon", description: "Explore feature is not available yet." })
            }
          >
            Explore
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              toast({ title: "Coming Soon", description: "Pool feature is not available yet." })
            }
          >
            Pool
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              toast({ title: "Coming Soon", description: "Meme feature is not available yet." })
            }
          >
            Meme
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <SunIcon className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <MoonIcon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
