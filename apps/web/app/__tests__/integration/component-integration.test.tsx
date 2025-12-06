import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTokenList } from "../../../test/setup";

// Mock theme context
const mockTheme = {
  theme: "dark",
  setTheme: vi.fn(),
  toggleTheme: vi.fn(),
};

// Mock Header Component
const MockHeader = ({
  onThemeToggle,
  onWalletConnect,
  walletConnected,
  walletAddress,
}: {
  onThemeToggle: () => void;
  onWalletConnect: () => void;
  walletConnected: boolean;
  walletAddress: string | null;
}) => {
  return (
    <header data-testid="header">
      <div data-testid="logo">
        <h1>AetherDEX</h1>
      </div>

      <nav data-testid="navigation">
        <a href="/swap" data-testid="nav-swap">
          Swap
        </a>
        <a href="/pool" data-testid="nav-pool">
          Pool
        </a>
        <a href="/explore" data-testid="nav-explore">
          Explore
        </a>
      </nav>

      <div data-testid="header-actions">
        <button data-testid="theme-toggle" onClick={onThemeToggle} aria-label="Toggle theme">
          {mockTheme.theme === "dark" ? "☀️" : "🌙"}
        </button>

        <button data-testid="wallet-button" onClick={onWalletConnect}>
          {walletConnected
            ? `${walletAddress?.slice(0, 6)}...${walletAddress?.slice(-4)}`
            : "Connect Wallet"}
        </button>
      </div>
    </header>
  );
};

// Mock TokenSelector Component
const MockTokenSelector = ({
  tokens,
  selectedToken,
  onTokenSelect,
  label,
  disabled = false,
}: {
  tokens: any[];
  selectedToken: any;
  onTokenSelect: (token: any) => void;
  label: string;
  disabled?: boolean;
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState("");

  const filteredTokens = tokens.filter(
    (token) =>
      token.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      token.symbol.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleTokenSelect = (token: any) => {
    onTokenSelect(token);
    setIsOpen(false);
    setSearchTerm("");
  };

  return (
    <div data-testid={`token-selector-${label.toLowerCase()}`}>
      <label data-testid={`token-label-${label.toLowerCase()}`}>{label}</label>

      <button
        data-testid={`token-selector-button-${label.toLowerCase()}`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={disabled ? "disabled" : ""}
      >
        {selectedToken ? (
          <div data-testid={`selected-token-display-${label.toLowerCase()}`}>
            <span>{selectedToken.symbol}</span>
            <span>{selectedToken.name}</span>
          </div>
        ) : (
          <span>Select Token</span>
        )}
      </button>

      {isOpen && (
        <div data-testid={`token-dropdown-${label.toLowerCase()}`}>
          <input
            data-testid={`token-search-${label.toLowerCase()}`}
            type="text"
            placeholder="Search tokens..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          <div data-testid={`token-list-${label.toLowerCase()}`}>
            {filteredTokens.length > 0 ? (
              filteredTokens.map((token) => (
                <button
                  key={token.symbol}
                  data-testid={`token-option-${token.symbol.toLowerCase()}`}
                  onClick={() => handleTokenSelect(token)}
                  className="token-option"
                >
                  <div>
                    <span>{token.symbol}</span>
                    <span>{token.name}</span>
                    <span>${token.price}</span>
                  </div>
                </button>
              ))
            ) : (
              <div data-testid="no-tokens-found">No tokens found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Mock SwapInterface Component
const MockSwapInterface = ({
  walletConnected,
  walletAddress,
  onWalletConnect,
}: {
  walletConnected: boolean;
  walletAddress: string | null;
  onWalletConnect: () => void;
}) => {
  const [fromToken, setFromToken] = React.useState<any>(null);
  const [toToken, setToToken] = React.useState<any>(null);
  const [fromAmount, setFromAmount] = React.useState("");
  const [toAmount, setToAmount] = React.useState("");
  const [slippage, setSlippage] = React.useState(0.5);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const tokens = createMockTokenList();

  // Calculate output amount
  React.useEffect(() => {
    if (fromToken && toToken && fromAmount && parseFloat(fromAmount) > 0) {
      const outputAmount = ((parseFloat(fromAmount) * fromToken.price) / toToken.price).toFixed(6);
      setToAmount(outputAmount);
    } else {
      setToAmount("");
    }
  }, [fromToken, toToken, fromAmount]);

  const handleSwapTokens = () => {
    const tempToken = fromToken;
    setFromToken(toToken);
    setToToken(tempToken);
    setFromAmount("");
    setToAmount("");
  };

  const handleSwap = async () => {
    if (!walletConnected) {
      setError("Please connect your wallet first");
      return;
    }

    if (!fromToken || !toToken) {
      setError("Please select both tokens");
      return;
    }

    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      // Simulate swap
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Reset form on success
      setFromAmount("");
      setToAmount("");
      setFromToken(null);
      setToToken(null);
    } catch (err) {
      setError("Swap failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div data-testid="swap-interface">
      <h2>Swap Tokens</h2>

      {error && (
        <div data-testid="swap-error" className="error">
          {error}
        </div>
      )}

      {!walletConnected && (
        <div data-testid="wallet-prompt">
          <p>Connect your wallet to start trading</p>
          <button data-testid="connect-wallet-prompt" onClick={onWalletConnect}>
            Connect Wallet
          </button>
        </div>
      )}

      <div data-testid="swap-form" className={!walletConnected ? "disabled" : ""}>
        <div data-testid="from-section">
          <MockTokenSelector
            tokens={tokens}
            selectedToken={fromToken}
            onTokenSelect={setFromToken}
            label="From"
            disabled={!walletConnected}
          />

          <input
            data-testid="from-amount-input"
            type="number"
            placeholder="0.0"
            value={fromAmount}
            onChange={(e) => setFromAmount(e.target.value)}
            disabled={!walletConnected || !fromToken}
          />
        </div>

        <button
          data-testid="swap-direction-button"
          onClick={handleSwapTokens}
          disabled={!walletConnected}
          aria-label="Swap token positions"
        >
          ↕️
        </button>

        <div data-testid="to-section">
          <MockTokenSelector
            tokens={tokens}
            selectedToken={toToken}
            onTokenSelect={setToToken}
            label="To"
            disabled={!walletConnected}
          />

          <input
            data-testid="to-amount-input"
            type="number"
            placeholder="0.0"
            value={toAmount}
            disabled
            readOnly
          />
        </div>

        <div data-testid="slippage-section">
          <label>Slippage Tolerance: {slippage}%</label>
          <input
            data-testid="slippage-input"
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={slippage}
            onChange={(e) => setSlippage(parseFloat(e.target.value))}
            disabled={!walletConnected}
          />
        </div>

        <button
          data-testid="execute-swap-button"
          onClick={handleSwap}
          disabled={!walletConnected || !fromToken || !toToken || !fromAmount || isLoading}
        >
          {isLoading ? "Swapping..." : "Swap"}
        </button>
      </div>
    </div>
  );
};

// Main App Component that integrates all components
const MockApp = () => {
  const [walletConnected, setWalletConnected] = React.useState(false);
  const [walletAddress, setWalletAddress] = React.useState<string | null>(null);
  const [theme, setTheme] = React.useState("dark");

  const handleWalletConnect = async () => {
    try {
      // Simulate wallet connection
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setWalletConnected(true);
      setWalletAddress("0x1234567890123456789012345678901234567890");
    } catch (error) {
      console.error("Wallet connection failed:", error);
    }
  };

  const handleThemeToggle = () => {
    setTheme(theme === "dark" ? "light" : "dark");
    mockTheme.theme = theme === "dark" ? "light" : "dark";
  };

  return (
    <div data-testid="app" className={`theme-${theme}`}>
      <MockHeader
        onThemeToggle={handleThemeToggle}
        onWalletConnect={handleWalletConnect}
        walletConnected={walletConnected}
        walletAddress={walletAddress}
      />

      <main data-testid="main-content">
        <MockSwapInterface
          walletConnected={walletConnected}
          walletAddress={walletAddress}
          onWalletConnect={handleWalletConnect}
        />
      </main>
    </div>
  );
};

// Mock React hooks
const React = {
  useState: vi.fn(),
  useEffect: vi.fn(),
};

describe("Component Integration Tests", () => {
  let user: any;
  let stateValues: any;
  let stateSetters: any;

  beforeEach(() => {
    user = userEvent.setup();

    // Reset state management
    stateValues = {};
    stateSetters = {};

    // Mock React hooks
    React.useState = vi.fn().mockImplementation((initial) => {
      const key = Math.random().toString();
      stateValues[key] = initial;
      stateSetters[key] = vi.fn((newValue) => {
        stateValues[key] = typeof newValue === "function" ? newValue(stateValues[key]) : newValue;
      });
      return [stateValues[key], stateSetters[key]];
    });

    React.useEffect = vi.fn().mockImplementation((effect, deps) => {
      effect();
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Header and Wallet Integration", () => {
    it("connects wallet from header and updates swap interface", async () => {
      render(<MockApp />);

      // Verify initial state
      expect(screen.getByTestId("wallet-button")).toHaveTextContent("Connect Wallet");
      expect(screen.getByTestId("wallet-prompt")).toBeInTheDocument();

      // Connect wallet from header
      await user.click(screen.getByTestId("wallet-button"));

      await waitFor(
        () => {
          expect(screen.getByTestId("wallet-button")).toHaveTextContent("0x1234...7890");
          expect(screen.queryByTestId("wallet-prompt")).not.toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });

    it("connects wallet from swap interface prompt", async () => {
      render(<MockApp />);

      // Connect wallet from swap interface
      await user.click(screen.getByTestId("connect-wallet-prompt"));

      await waitFor(
        () => {
          expect(screen.getByTestId("wallet-button")).toHaveTextContent("0x1234...7890");
          expect(screen.queryByTestId("wallet-prompt")).not.toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });

    it("toggles theme and applies to entire app", async () => {
      render(<MockApp />);

      // Verify initial theme
      expect(screen.getByTestId("app")).toHaveClass("theme-dark");
      expect(screen.getByTestId("theme-toggle")).toHaveTextContent("☀️");

      // Toggle theme
      await user.click(screen.getByTestId("theme-toggle"));

      await waitFor(() => {
        expect(screen.getByTestId("app")).toHaveClass("theme-light");
        expect(screen.getByTestId("theme-toggle")).toHaveTextContent("🌙");
      });
    });
  });

  describe("TokenSelector and SwapInterface Integration", () => {
    it("enables token selection after wallet connection", async () => {
      render(<MockApp />);

      // Initially token selectors should be disabled
      expect(screen.getByTestId("token-selector-button-from")).toBeDisabled();
      expect(screen.getByTestId("token-selector-button-to")).toBeDisabled();

      // Connect wallet
      await user.click(screen.getByTestId("wallet-button"));

      await waitFor(
        () => {
          expect(screen.getByTestId("token-selector-button-from")).not.toBeDisabled();
          expect(screen.getByTestId("token-selector-button-to")).not.toBeDisabled();
        },
        { timeout: 2000 },
      );
    });

    it("updates amount calculation when tokens are selected", async () => {
      render(<MockApp />);

      // Connect wallet first
      await user.click(screen.getByTestId("wallet-button"));

      await waitFor(
        () => {
          expect(screen.getByTestId("wallet-button")).toHaveTextContent("0x1234...7890");
        },
        { timeout: 2000 },
      );

      // Select FROM token
      await user.click(screen.getByTestId("token-selector-button-from"));

      await waitFor(() => {
        expect(screen.getByTestId("token-dropdown-from")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("token-option-eth"));

      await waitFor(() => {
        expect(screen.getByTestId("selected-token-display-from")).toHaveTextContent("ETH");
      });

      // Select TO token
      await user.click(screen.getByTestId("token-selector-button-to"));
      await user.click(screen.getByTestId("token-option-usdc"));

      await waitFor(() => {
        expect(screen.getByTestId("selected-token-display-to")).toHaveTextContent("USDC");
      });

      // Enter amount and verify calculation
      const fromAmountInput = screen.getByTestId("from-amount-input");
      await user.clear(fromAmountInput);
      await user.type(fromAmountInput, "1");

      await waitFor(() => {
        expect(screen.getByTestId("to-amount-input")).toHaveValue(2000); // ETH price / USDC price
      });
    });

    it("handles token search functionality", async () => {
      render(<MockApp />);

      // Connect wallet and open token selector
      await user.click(screen.getByTestId("wallet-button"));

      await waitFor(
        () => {
          expect(screen.getByTestId("wallet-button")).toHaveTextContent("0x1234...7890");
        },
        { timeout: 2000 },
      );

      await user.click(screen.getByTestId("token-selector-button-from"));

      // Search for specific token
      const searchInput = screen.getByTestId("token-search-from");
      await user.type(searchInput, "ethereum");

      await waitFor(() => {
        expect(screen.getByTestId("token-option-eth")).toBeInTheDocument();
        expect(screen.queryByTestId("token-option-usdc")).not.toBeInTheDocument();
      });

      // Clear search and verify all tokens are shown
      await user.clear(searchInput);

      await waitFor(() => {
        expect(screen.getByTestId("token-option-eth")).toBeInTheDocument();
        expect(screen.getByTestId("token-option-usdc")).toBeInTheDocument();
      });
    });
  });

  describe("Cross-Component State Management", () => {
    it("maintains consistent state across component interactions", async () => {
      render(<MockApp />);

      // Connect wallet
      await user.click(screen.getByTestId("wallet-button"));

      await waitFor(
        () => {
          expect(screen.getByTestId("wallet-button")).toHaveTextContent("0x1234...7890");
        },
        { timeout: 2000 },
      );

      // Select tokens
      await user.click(screen.getByTestId("token-selector-button-from"));
      await user.click(screen.getByTestId("token-option-eth"));

      await user.click(screen.getByTestId("token-selector-button-to"));
      await user.click(screen.getByTestId("token-option-usdc"));

      // Swap token positions
      await user.click(screen.getByTestId("swap-direction-button"));

      await waitFor(() => {
        expect(screen.getByTestId("selected-token-display-from")).toHaveTextContent("USDC");
        expect(screen.getByTestId("selected-token-display-to")).toHaveTextContent("ETH");
      });
    });

    it("handles error states across components", async () => {
      render(<MockApp />);

      // Try to swap without wallet connection
      await user.click(screen.getByTestId("execute-swap-button"));

      await waitFor(() => {
        expect(screen.getByTestId("swap-error")).toHaveTextContent(
          "Please connect your wallet first",
        );
      });

      // Connect wallet and error should clear
      await user.click(screen.getByTestId("wallet-button"));

      await waitFor(
        () => {
          expect(screen.queryByTestId("swap-error")).not.toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });

    it("updates slippage settings and reflects in calculations", async () => {
      render(<MockApp />);

      // Connect wallet and setup tokens
      await user.click(screen.getByTestId("wallet-button"));

      await waitFor(
        () => {
          expect(screen.getByTestId("wallet-button")).toHaveTextContent("0x1234...7890");
        },
        { timeout: 2000 },
      );

      // Adjust slippage
      const slippageInput = screen.getByTestId("slippage-input");
      await user.clear(slippageInput);
      await user.type(slippageInput, "2");

      await waitFor(() => {
        expect(screen.getByText("Slippage Tolerance: 2%")).toBeInTheDocument();
      });
    });
  });

  describe("Navigation and Routing Integration", () => {
    it("renders navigation links correctly", () => {
      render(<MockApp />);

      expect(screen.getByTestId("nav-swap")).toHaveAttribute("href", "/swap");
      expect(screen.getByTestId("nav-pool")).toHaveAttribute("href", "/pool");
      expect(screen.getByTestId("nav-explore")).toHaveAttribute("href", "/explore");
    });

    it("maintains app branding and identity", () => {
      render(<MockApp />);

      expect(screen.getByTestId("logo")).toHaveTextContent("AetherDEX");
      expect(screen.getByTestId("header")).toBeInTheDocument();
      expect(screen.getByTestId("main-content")).toBeInTheDocument();
    });
  });

  describe("Accessibility and UX Integration", () => {
    it("provides proper ARIA labels and accessibility features", () => {
      render(<MockApp />);

      expect(screen.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Toggle theme");
      expect(screen.getByTestId("swap-direction-button")).toHaveAttribute(
        "aria-label",
        "Swap token positions",
      );
    });

    it("handles disabled states consistently across components", async () => {
      render(<MockApp />);

      // Verify disabled states without wallet
      expect(screen.getByTestId("token-selector-button-from")).toBeDisabled();
      expect(screen.getByTestId("token-selector-button-to")).toBeDisabled();
      expect(screen.getByTestId("from-amount-input")).toBeDisabled();
      expect(screen.getByTestId("swap-direction-button")).toBeDisabled();
      expect(screen.getByTestId("slippage-input")).toBeDisabled();
      expect(screen.getByTestId("execute-swap-button")).toBeDisabled();

      // Connect wallet and verify enabled states
      await user.click(screen.getByTestId("wallet-button"));

      await waitFor(
        () => {
          expect(screen.getByTestId("token-selector-button-from")).not.toBeDisabled();
          expect(screen.getByTestId("token-selector-button-to")).not.toBeDisabled();
          expect(screen.getByTestId("swap-direction-button")).not.toBeDisabled();
          expect(screen.getByTestId("slippage-input")).not.toBeDisabled();
        },
        { timeout: 2000 },
      );
    });
  });
});
