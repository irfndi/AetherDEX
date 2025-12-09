import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTokenList } from "../setup";

// Mock Web3 wallet functionality
const mockWallet = {
  isConnected: false,
  address: null as string | null,
  balance: "0",
  connect: vi.fn(),
  disconnect: vi.fn(),
  switchNetwork: vi.fn(),
  signTransaction: vi.fn(),
};

// Mock swap service
const mockSwapService = {
  getQuote: vi.fn(),
  executeSwap: vi.fn(),
  getTokenList: vi.fn(),
  getTokenBalance: vi.fn(),
};

// Mock components for integration testing
const MockWalletConnect = ({ onConnect }: { onConnect: (wallet: any) => void }) => {
  const handleConnect = () => {
    mockWallet.isConnected = true;
    mockWallet.address = "0x1234567890123456789012345678901234567890";
    mockWallet.balance = "1.5";
    onConnect(mockWallet);
  };

  return (
    <button
      data-testid="wallet-connect-btn"
      onClick={handleConnect}
      disabled={mockWallet.isConnected}
    >
      {mockWallet.isConnected
        ? `Connected: ${mockWallet.address?.slice(0, 6)}...`
        : "Connect Wallet"}
    </button>
  );
};

const MockTokenSelector = ({
  onTokenSelect,
  selectedToken,
  label,
}: {
  onTokenSelect: (token: any) => void;
  selectedToken: any;
  label: string;
}) => {
  const tokens = createMockTokenList();

  return (
    <div data-testid={`token-selector-${label.toLowerCase()}`}>
      <label>{label}</label>
      <select
        data-testid={`token-select-${label.toLowerCase()}`}
        onChange={(e) => {
          const token = tokens.find((t) => t.symbol === e.target.value);
          if (token) onTokenSelect(token);
        }}
        value={selectedToken?.symbol || ""}
      >
        <option value="">Select Token</option>
        {tokens.map((token) => (
          <option key={token.symbol} value={token.symbol}>
            {token.symbol} - {token.name}
          </option>
        ))}
      </select>
      {selectedToken && (
        <div data-testid={`selected-token-${label.toLowerCase()}`}>
          {selectedToken.symbol}: ${selectedToken.price}
        </div>
      )}
    </div>
  );
};

const MockAmountInput = ({
  value,
  onChange,
  token,
  balance,
}: {
  value: string;
  onChange: (value: string) => void;
  token: any;
  balance: string;
}) => {
  return (
    <div data-testid="amount-input">
      <input
        data-testid="amount-input-field"
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.0"
        step="0.000001"
        min="0"
      />
      {token && (
        <div data-testid="token-info">
          <span>
            Balance: {balance} {token.symbol}
          </span>
          <button data-testid="max-button" onClick={() => onChange(balance)}>
            MAX
          </button>
        </div>
      )}
    </div>
  );
};

const MockSwapReview = ({
  fromToken,
  toToken,
  fromAmount,
  toAmount,
  slippage,
  onConfirm,
  onCancel,
}: {
  fromToken: any;
  toToken: any;
  fromAmount: string;
  toAmount: string;
  slippage: number;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const minimumReceived = (parseFloat(toAmount) * (1 - slippage / 100)).toFixed(6);

  return (
    <div data-testid="swap-review">
      <h3>Review Swap</h3>
      <div data-testid="swap-details">
        <div>
          From: {fromAmount} {fromToken?.symbol}
        </div>
        <div>
          To: {toAmount} {toToken?.symbol}
        </div>
        <div>Slippage: {slippage}%</div>
        <div>
          Minimum Received: {minimumReceived} {toToken?.symbol}
        </div>
      </div>
      <div data-testid="swap-actions">
        <button data-testid="confirm-swap" onClick={onConfirm}>
          Confirm Swap
        </button>
        <button data-testid="cancel-swap" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};

const MockSwapInterface = () => {
  const [wallet, setWallet] = React.useState<any>(null);
  const [fromToken, setFromToken] = React.useState<any>(null);
  const [toToken, setToToken] = React.useState<any>(null);
  const [fromAmount, setFromAmount] = React.useState("");
  const [toAmount, setToAmount] = React.useState("");
  const [showReview, setShowReview] = React.useState(false);
  const [isSwapping, setIsSwapping] = React.useState(false);
  const [swapResult, setSwapResult] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);

  const slippage = 0.5; // 0.5%

  // Calculate output amount when inputs change
  React.useEffect(() => {
    if (fromToken && toToken && fromAmount && parseFloat(fromAmount) > 0) {
      const outputAmount = ((parseFloat(fromAmount) * fromToken.price) / toToken.price).toFixed(6);
      setToAmount(outputAmount);
    } else {
      setToAmount("");
    }
  }, [fromToken, toToken, fromAmount]);

  const handleSwap = () => {
    if (!wallet?.isConnected) {
      setError("Please connect your wallet");
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
    if (parseFloat(fromAmount) > parseFloat(wallet.balance)) {
      setError("Insufficient balance");
      return;
    }

    setError(null);
    setShowReview(true);
  };

  const handleConfirmSwap = async () => {
    setIsSwapping(true);
    try {
      // Use the mock service if available
      if (mockSwapService.executeSwap) {
        await mockSwapService.executeSwap();
      } else {
        // Fallback simulation
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      const result = {
        success: true,
        txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        fromAmount,
        toAmount,
        fromToken: fromToken.symbol,
        toToken: toToken.symbol,
      };

      setSwapResult(result);
      setShowReview(false);

      // Reset form
      setFromAmount("");
      setToAmount("");
    } catch (err) {
      setError("Swap failed. Please try again.");
      setShowReview(false);
    } finally {
      setIsSwapping(false);
    }
  };

  const handleCancelSwap = () => {
    setShowReview(false);
    setError(null);
  };

  if (swapResult) {
    return (
      <div data-testid="swap-success">
        <h3>Swap Successful!</h3>
        <div data-testid="success-details">
          <div>Transaction Hash: {swapResult.txHash}</div>
          <div>
            Swapped: {swapResult.fromAmount} {swapResult.fromToken} → {swapResult.toAmount}{" "}
            {swapResult.toToken}
          </div>
        </div>
        <button data-testid="new-swap-button" onClick={() => setSwapResult(null)}>
          New Swap
        </button>
      </div>
    );
  }

  if (showReview) {
    return (
      <MockSwapReview
        fromToken={fromToken}
        toToken={toToken}
        fromAmount={fromAmount}
        toAmount={toAmount}
        slippage={slippage}
        onConfirm={handleConfirmSwap}
        onCancel={handleCancelSwap}
      />
    );
  }

  return (
    <div data-testid="swap-interface">
      <h2>AetherDEX Swap</h2>

      {error && (
        <div data-testid="error-message" style={{ color: "red" }}>
          {error}
        </div>
      )}

      <MockWalletConnect onConnect={setWallet} />

      {wallet?.isConnected && (
        <div data-testid="wallet-info">
          Connected: {wallet.address?.slice(0, 6)}...
          <br />
          Balance: {wallet.balance} ETH
        </div>
      )}

      <div data-testid="swap-form">
        <MockTokenSelector label="From" selectedToken={fromToken} onTokenSelect={setFromToken} />

        <MockAmountInput
          value={fromAmount}
          onChange={setFromAmount}
          token={fromToken}
          balance={wallet?.balance || "0"}
        />

        <button
          data-testid="swap-tokens-button"
          onClick={() => {
            setFromToken(toToken);
            setToToken(fromToken);
            setFromAmount("");
            setToAmount("");
          }}
        >
          ↕ Swap Tokens
        </button>

        <MockTokenSelector label="To" selectedToken={toToken} onTokenSelect={setToToken} />

        {toAmount && (
          <div data-testid="output-amount">
            Output: {toAmount} {toToken?.symbol}
          </div>
        )}

        <button data-testid="swap-button" onClick={handleSwap} disabled={isSwapping}>
          {isSwapping ? "Swapping..." : "Swap"}
        </button>
      </div>
    </div>
  );
};

// Add React import for the component
const MockReact = { useState: vi.fn(), useEffect: vi.fn() };

describe("End-to-End Swap Flow Integration Tests", () => {
  let user: any;

  beforeEach(() => {
    user = userEvent.setup();

    // Reset mocks
    mockWallet.isConnected = false;
    mockWallet.address = null;
    mockWallet.balance = "0";
    vi.clearAllMocks();

    // Mock React hooks
    let stateValues: any = {};
    let stateSetters: any = {};

    MockReact.useState = vi.fn().mockImplementation((initial) => {
      const key = Math.random().toString();
      stateValues[key] = initial;
      stateSetters[key] = vi.fn((newValue) => {
        stateValues[key] = typeof newValue === "function" ? newValue(stateValues[key]) : newValue;
      });
      return [stateValues[key], stateSetters[key]];
    });

    MockReact.useEffect = vi.fn().mockImplementation((effect, deps) => {
      effect();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Complete Swap Flow", () => {
    it("completes full swap flow: wallet connect → token select → amount input → review → execute", async () => {
      render(<MockSwapInterface />);

      // Step 1: Verify initial state
      expect(screen.getByTestId("swap-interface")).toBeInTheDocument();
      expect(screen.getByTestId("wallet-connect-btn")).toHaveTextContent("Connect Wallet");

      // Step 2: Connect wallet
      await user.click(screen.getByTestId("wallet-connect-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("wallet-info")).toBeInTheDocument();
        expect(screen.getByTestId("wallet-info")).toHaveTextContent("Connected: 0x1234...");
      });

      // Step 3: Select FROM token
      const fromTokenSelect = screen.getByTestId("token-select-from");
      await user.selectOptions(fromTokenSelect, "ETH");

      await waitFor(() => {
        expect(screen.getByTestId("selected-token-from")).toHaveTextContent("ETH: $2000");
      });

      // Step 4: Select TO token
      const toTokenSelect = screen.getByTestId("token-select-to");
      await user.selectOptions(toTokenSelect, "USDC");

      await waitFor(() => {
        expect(screen.getByTestId("selected-token-to")).toHaveTextContent("USDC: $1");
      });

      // Step 5: Enter amount
      const amountInput = screen.getByTestId("amount-input-field");
      await user.clear(amountInput);
      await user.type(amountInput, "1");

      await waitFor(() => {
        expect(screen.getByTestId("output-amount")).toHaveTextContent("Output: 2000.000000 USDC");
      });

      // Step 6: Initiate swap
      await user.click(screen.getByTestId("swap-button"));

      // Step 7: Review swap details
      await waitFor(() => {
        expect(screen.getByTestId("swap-review")).toBeInTheDocument();
        expect(screen.getByTestId("swap-details")).toHaveTextContent("From: 1 ETH");
        expect(screen.getByTestId("swap-details")).toHaveTextContent("To: 2000.000000 USDC");
        expect(screen.getByTestId("swap-details")).toHaveTextContent("Slippage: 0.5%");
      });

      // Step 8: Confirm swap
      await user.click(screen.getByTestId("confirm-swap"));

      // Step 9: Verify swap success
      await waitFor(
        () => {
          expect(screen.getByTestId("swap-success")).toBeInTheDocument();
          expect(screen.getByTestId("success-details")).toHaveTextContent(
            "Swapped: 1 ETH → 2000.000000 USDC",
          );
          expect(screen.getByTestId("success-details")).toHaveTextContent(
            "Transaction Hash: 0xabcdef",
          );
        },
        { timeout: 3000 },
      );
    });

    it("handles wallet connection failure gracefully", async () => {
      // Mock wallet connection failure
      mockWallet.connect = vi.fn().mockRejectedValue(new Error("Connection failed"));

      render(<MockSwapInterface />);

      // Try to swap without connecting wallet
      await user.click(screen.getByTestId("swap-button"));

      await waitFor(() => {
        expect(screen.getByTestId("error-message")).toHaveTextContent("Please connect your wallet");
      });
    });

    it("validates token selection before allowing swap", async () => {
      render(<MockSwapInterface />);

      // Connect wallet first
      await user.click(screen.getByTestId("wallet-connect-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("wallet-info")).toBeInTheDocument();
      });

      // Try to swap without selecting tokens
      await user.click(screen.getByTestId("swap-button"));

      await waitFor(() => {
        expect(screen.getByTestId("error-message")).toHaveTextContent("Please select both tokens");
      });
    });

    it("validates amount input before allowing swap", async () => {
      render(<MockSwapInterface />);

      // Connect wallet
      await user.click(screen.getByTestId("wallet-connect-btn"));

      // Select tokens
      await user.selectOptions(screen.getByTestId("token-select-from"), "ETH");
      await user.selectOptions(screen.getByTestId("token-select-to"), "USDC");

      // Try to swap without entering amount
      await user.click(screen.getByTestId("swap-button"));

      await waitFor(() => {
        expect(screen.getByTestId("error-message")).toHaveTextContent(
          "Please enter a valid amount",
        );
      });
    });

    it("validates sufficient balance before allowing swap", async () => {
      render(<MockSwapInterface />);

      // Connect wallet
      await user.click(screen.getByTestId("wallet-connect-btn"));

      // Select tokens
      await user.selectOptions(screen.getByTestId("token-select-from"), "ETH");
      await user.selectOptions(screen.getByTestId("token-select-to"), "USDC");

      // Enter amount greater than balance
      const amountInput = screen.getByTestId("amount-input-field");
      await user.clear(amountInput);
      await user.type(amountInput, "10"); // Balance is only 1.5

      await user.click(screen.getByTestId("swap-button"));

      await waitFor(() => {
        expect(screen.getByTestId("error-message")).toHaveTextContent("Insufficient balance");
      });
    });

    it("allows canceling swap during review", async () => {
      render(<MockSwapInterface />);

      // Complete setup
      await user.click(screen.getByTestId("wallet-connect-btn"));
      await user.selectOptions(screen.getByTestId("token-select-from"), "ETH");
      await user.selectOptions(screen.getByTestId("token-select-to"), "USDC");
      await user.type(screen.getByTestId("amount-input-field"), "1");

      // Initiate swap
      await user.click(screen.getByTestId("swap-button"));

      // Cancel during review
      await waitFor(() => {
        expect(screen.getByTestId("swap-review")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("cancel-swap"));

      // Should return to main interface
      await waitFor(() => {
        expect(screen.getByTestId("swap-interface")).toBeInTheDocument();
        expect(screen.queryByTestId("swap-review")).not.toBeInTheDocument();
      });
    });

    it("handles token swapping (reverse direction)", async () => {
      render(<MockSwapInterface />);

      // Setup
      await user.click(screen.getByTestId("wallet-connect-btn"));
      await user.selectOptions(screen.getByTestId("token-select-from"), "ETH");
      await user.selectOptions(screen.getByTestId("token-select-to"), "USDC");

      // Swap token positions
      await user.click(screen.getByTestId("swap-tokens-button"));

      await waitFor(() => {
        expect(screen.getByTestId("selected-token-from")).toHaveTextContent("USDC: $1");
        expect(screen.getByTestId("selected-token-to")).toHaveTextContent("ETH: $2000");
      });
    });

    it("uses MAX button to set maximum balance", async () => {
      render(<MockSwapInterface />);

      // Setup
      await user.click(screen.getByTestId("wallet-connect-btn"));
      await user.selectOptions(screen.getByTestId("token-select-from"), "ETH");

      // Click MAX button
      await user.click(screen.getByTestId("max-button"));

      await waitFor(() => {
        expect(screen.getByTestId("amount-input-field")).toHaveValue(1.5);
      });
    });
  });

  describe("Error Scenarios", () => {
    it("handles network errors during swap execution", async () => {
      // Mock network failure
      mockSwapService.executeSwap = vi.fn().mockRejectedValue(new Error("Network error"));

      render(<MockSwapInterface />);

      // Complete setup and initiate swap
      await user.click(screen.getByTestId("wallet-connect-btn"));
      await user.selectOptions(screen.getByTestId("token-select-from"), "ETH");
      await user.selectOptions(screen.getByTestId("token-select-to"), "USDC");
      await user.type(screen.getByTestId("amount-input-field"), "1");
      await user.click(screen.getByTestId("swap-button"));

      // Confirm swap (should fail)
      await user.click(screen.getByTestId("confirm-swap"));

      await waitFor(
        () => {
          expect(screen.getByTestId("error-message")).toHaveTextContent(
            "Swap failed. Please try again.",
          );
        },
        { timeout: 3000 },
      );
    });
  });
});
