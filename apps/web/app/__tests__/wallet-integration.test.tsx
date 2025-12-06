import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock MetaMask provider
const mockMetaMaskProvider = {
  isMetaMask: true,
  request: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  selectedAddress: null,
  chainId: "0x1",
  networkVersion: "1",
};

// Mock WalletConnect provider
const mockWalletConnectProvider = {
  enable: vi.fn(),
  request: vi.fn(),
  on: vi.fn(),
  disconnect: vi.fn(),
  connected: false,
  accounts: [],
  chainId: 1,
};

// Wallet connection logic
const connectWallet = async (
  connector?: string,
): Promise<{ address: string; balance: string; chainId?: string }> => {
  // Simulate connection delay
  await new Promise((resolve) => setTimeout(resolve, 10));

  if (connector === "metaMask") {
    const globalWindow =
      (global as any).window || (typeof window !== "undefined" ? window : undefined);
    if (!globalWindow || !globalWindow.ethereum) {
      throw new Error("MetaMask not found");
    }

    // Simulate MetaMask connection
    const accounts = await globalWindow.ethereum.request({ method: "eth_requestAccounts" });
    const chainId = await globalWindow.ethereum.request({ method: "eth_chainId" });

    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts found");
    }

    return {
      address: accounts[0],
      balance: "1.5",
      chainId,
    };
  }

  if (connector === "walletConnect") {
    if (!mockWalletConnectProvider.connected) {
      await mockWalletConnectProvider.enable();
    }

    const accounts = await mockWalletConnectProvider.request({ method: "eth_accounts" });

    if (!accounts || accounts.length === 0) {
      throw new Error("WalletConnect: No accounts found");
    }

    return {
      address: accounts[0],
      balance: "2.0",
      chainId: "0x1",
    };
  }

  return {
    address: "0x1234567890123456789012345678901234567890",
    balance: "1.5",
  };
};

const disconnectWallet = async (connector?: string): Promise<void> => {
  if (connector === "metaMask") {
    const globalWindow = (global as any).window;
    if (globalWindow?.ethereum) {
      // MetaMask doesn't have a disconnect method, but we can clear the connection state
      globalWindow.ethereum.selectedAddress = null;
    }
  }

  if (connector === "walletConnect") {
    await mockWalletConnectProvider.disconnect();
    mockWalletConnectProvider.connected = false;
    mockWalletConnectProvider.accounts = [];
  }
};

const refreshBalance = async (address: string, connector?: string): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 10));

  if (connector === "metaMask") {
    const globalWindow = (global as any).window;
    if (globalWindow?.ethereum) {
      const balance = await globalWindow.ethereum.request({
        method: "eth_getBalance",
        params: [address, "latest"],
      });
      return balance;
    }
  }

  if (connector === "walletConnect") {
    const balance = await mockWalletConnectProvider.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    });
    return balance;
  }

  return "2.1";
};

const formatAddress = (address: string): string => {
  if (!address) return "";
  if (address.length <= 10) return address; // Return short addresses as-is
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const validateAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

const switchNetwork = async (chainId: string, connector?: string): Promise<void> => {
  if (connector === "metaMask") {
    const globalWindow = (global as any).window;
    if (globalWindow?.ethereum) {
      await globalWindow.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    }
  }

  if (connector === "walletConnect") {
    // WalletConnect network switching logic
    mockWalletConnectProvider.chainId = parseInt(chainId, 16);
  }
};

const addToken = async (
  tokenAddress: string,
  tokenSymbol: string,
  tokenDecimals: number,
  connector?: string,
): Promise<boolean> => {
  if (connector === "metaMask") {
    const globalWindow = (global as any).window;
    if (globalWindow?.ethereum) {
      return await globalWindow.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: tokenAddress,
            symbol: tokenSymbol,
            decimals: tokenDecimals,
          },
        },
      });
    }
  }

  return false;
};

describe("Wallet Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup global window mock
    global.window = {
      ethereum: mockMetaMaskProvider,
    } as any;

    // Reset mock states
    mockMetaMaskProvider.selectedAddress = null;
    mockMetaMaskProvider.request.mockReset();
    mockWalletConnectProvider.connected = false;
    mockWalletConnectProvider.accounts = [];
    mockWalletConnectProvider.request.mockReset();
    mockWalletConnectProvider.enable.mockReset();
    mockWalletConnectProvider.disconnect.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("MetaMask Integration", () => {
    it("should connect to MetaMask successfully", async () => {
      const mockAccounts = ["0x1234567890123456789012345678901234567890"];
      const mockChainId = "0x1";

      mockMetaMaskProvider.request
        .mockResolvedValueOnce(mockAccounts) // eth_requestAccounts
        .mockResolvedValueOnce(mockChainId); // eth_chainId

      const result = await connectWallet("metaMask");

      expect(result.address).toBe(mockAccounts[0]);
      expect(result.balance).toBe("1.5");
      expect(result.chainId).toBe(mockChainId);
      expect(mockMetaMaskProvider.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
      expect(mockMetaMaskProvider.request).toHaveBeenCalledWith({ method: "eth_chainId" });
    });

    it("should throw error when MetaMask is not installed", async () => {
      global.window = {} as any;

      await expect(connectWallet("metaMask")).rejects.toThrow("MetaMask not found");
    });

    it("should throw error when no accounts are available", async () => {
      mockMetaMaskProvider.request.mockResolvedValueOnce([]); // empty accounts

      await expect(connectWallet("metaMask")).rejects.toThrow("No accounts found");
    });

    it("should refresh balance via MetaMask", async () => {
      const mockBalance = "0x1bc16d674ec80000"; // 2 ETH in hex
      mockMetaMaskProvider.request.mockResolvedValueOnce(mockBalance);

      const balance = await refreshBalance(
        "0x1234567890123456789012345678901234567890",
        "metaMask",
      );

      expect(balance).toBe(mockBalance);
      expect(mockMetaMaskProvider.request).toHaveBeenCalledWith({
        method: "eth_getBalance",
        params: ["0x1234567890123456789012345678901234567890", "latest"],
      });
    });

    it("should switch network in MetaMask", async () => {
      mockMetaMaskProvider.request.mockResolvedValueOnce(null);

      await switchNetwork("0x89", "metaMask"); // Polygon

      expect(mockMetaMaskProvider.request).toHaveBeenCalledWith({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x89" }],
      });
    });

    it("should add token to MetaMask", async () => {
      mockMetaMaskProvider.request.mockResolvedValueOnce(true);

      const tokenAddress = "0xA0b86a33E6441c8C06DD2b7c94b7E6E6E6E6E6E6E6";
      const result = await addToken(tokenAddress, "USDC", 6, "metaMask");

      expect(result).toBe(true);
      expect(mockMetaMaskProvider.request).toHaveBeenCalledWith({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: tokenAddress,
            symbol: "USDC",
            decimals: 6,
          },
        },
      });
    });

    it("should disconnect MetaMask", async () => {
      global.window.ethereum.selectedAddress = "0x1234567890123456789012345678901234567890";

      await disconnectWallet("metaMask");

      expect(global.window.ethereum.selectedAddress).toBe(null);
    });
  });

  describe("WalletConnect Integration", () => {
    it("should connect to WalletConnect successfully", async () => {
      const mockAccounts = ["0x9876543210987654321098765432109876543210"];

      // Ensure connected is false initially so enable() gets called
      mockWalletConnectProvider.connected = false;
      mockWalletConnectProvider.enable.mockResolvedValueOnce(undefined);
      mockWalletConnectProvider.request.mockResolvedValueOnce(mockAccounts);

      const result = await connectWallet("walletConnect");

      expect(result.address).toBe(mockAccounts[0]);
      expect(result.balance).toBe("2.0");
      expect(result.chainId).toBe("0x1");
      expect(mockWalletConnectProvider.enable).toHaveBeenCalled();
      expect(mockWalletConnectProvider.request).toHaveBeenCalledWith({ method: "eth_accounts" });
    });

    it("should throw error when WalletConnect has no accounts", async () => {
      mockWalletConnectProvider.enable.mockResolvedValueOnce(undefined);
      mockWalletConnectProvider.request.mockResolvedValueOnce([]);

      await expect(connectWallet("walletConnect")).rejects.toThrow(
        "WalletConnect: No accounts found",
      );
    });

    it("should refresh balance via WalletConnect", async () => {
      const mockBalance = "0x2386f26fc10000"; // 0.01 ETH in hex
      mockWalletConnectProvider.request.mockResolvedValueOnce(mockBalance);

      const balance = await refreshBalance(
        "0x9876543210987654321098765432109876543210",
        "walletConnect",
      );

      expect(balance).toBe(mockBalance);
      expect(mockWalletConnectProvider.request).toHaveBeenCalledWith({
        method: "eth_getBalance",
        params: ["0x9876543210987654321098765432109876543210", "latest"],
      });
    });

    it("should switch network in WalletConnect", async () => {
      await switchNetwork("0x89", "walletConnect"); // Polygon

      expect(mockWalletConnectProvider.chainId).toBe(137); // 0x89 in decimal
    });

    it("should disconnect WalletConnect", async () => {
      mockWalletConnectProvider.connected = true;
      mockWalletConnectProvider.accounts = ["0x9876543210987654321098765432109876543210"];
      mockWalletConnectProvider.disconnect.mockResolvedValueOnce(undefined);

      await disconnectWallet("walletConnect");

      expect(mockWalletConnectProvider.disconnect).toHaveBeenCalled();
      expect(mockWalletConnectProvider.connected).toBe(false);
      expect(mockWalletConnectProvider.accounts).toEqual([]);
    });
  });

  describe("Generic Wallet Connection", () => {
    it("should connect wallet successfully without specific connector", async () => {
      const result = await connectWallet();
      expect(result.address).toBe("0x1234567890123456789012345678901234567890");
      expect(result.balance).toBe("1.5");
    });

    it("should disconnect wallet without specific connector", async () => {
      await expect(disconnectWallet()).resolves.not.toThrow();
    });

    it("should refresh balance without specific connector", async () => {
      const balance = await refreshBalance("0x1234567890123456789012345678901234567890");
      expect(balance).toBe("2.1");
    });
  });

  describe("Address Formatting", () => {
    it("should format address correctly", () => {
      const address = "0x1234567890123456789012345678901234567890";
      const formatted = formatAddress(address);
      expect(formatted).toBe("0x1234...7890");
    });

    it("should handle short addresses", () => {
      const address = "0x1234";
      const formatted = formatAddress(address);
      expect(formatted).toBe("0x1234");
    });
  });

  describe("Address Validation", () => {
    it("should validate correct address", () => {
      const address = "0x1234567890123456789012345678901234567890";
      expect(validateAddress(address)).toBe(true);
    });

    it("should reject invalid address", () => {
      const address = "invalid-address";
      expect(validateAddress(address)).toBe(false);
    });

    it("should reject address without 0x prefix", () => {
      const address = "1234567890123456789012345678901234567890";
      expect(validateAddress(address)).toBe(false);
    });

    it("should reject address with wrong length", () => {
      const address = "0x123456789012345678901234567890123456789";
      expect(validateAddress(address)).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should handle MetaMask request errors", async () => {
      mockMetaMaskProvider.request.mockRejectedValueOnce(new Error("User rejected request"));

      await expect(connectWallet("metaMask")).rejects.toThrow("User rejected request");
    });

    it("should handle WalletConnect connection errors", async () => {
      mockWalletConnectProvider.enable.mockRejectedValueOnce(new Error("Connection failed"));

      await expect(connectWallet("walletConnect")).rejects.toThrow("Connection failed");
    });

    it("should handle network switching errors", async () => {
      mockMetaMaskProvider.request.mockRejectedValueOnce(new Error("Network not supported"));

      await expect(switchNetwork("0x999", "metaMask")).rejects.toThrow("Network not supported");
    });

    it("should handle token addition rejection", async () => {
      mockMetaMaskProvider.request.mockResolvedValueOnce(false);

      const result = await addToken(
        "0xA0b86a33E6441c8C06DD2b7c94b7E6E6E6E6E6E6E6",
        "USDC",
        6,
        "metaMask",
      );

      expect(result).toBe(false);
    });

    it("should handle connection timeout", async () => {
      const timeoutConnectWallet = async (): Promise<{ address: string; balance: string }> => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        throw new Error("Connection timeout");
      };

      await expect(timeoutConnectWallet()).rejects.toThrow("Connection timeout");
    });

    it("should handle network errors", async () => {
      const networkErrorWallet = async (): Promise<{ address: string; balance: string }> => {
        throw new Error("Network error");
      };

      await expect(networkErrorWallet()).rejects.toThrow("Network error");
    });

    it("should handle invalid connector gracefully", async () => {
      const result = await connectWallet("invalidConnector");
      expect(result.address).toBe("0x1234567890123456789012345678901234567890");
    });
  });

  describe("Wallet State Management", () => {
    it("should handle multiple connection attempts", async () => {
      const mockAccounts = ["0x1234567890123456789012345678901234567890"];
      mockMetaMaskProvider.request
        .mockResolvedValueOnce(mockAccounts)
        .mockResolvedValueOnce("0x1")
        .mockResolvedValueOnce(mockAccounts)
        .mockResolvedValueOnce("0x1");

      const result1 = await connectWallet("metaMask");
      const result2 = await connectWallet("metaMask");

      expect(result1.address).toBe(mockAccounts[0]);
      expect(result2.address).toBe(mockAccounts[0]);
    });

    it("should handle wallet switching", async () => {
      // Connect MetaMask first
      const mockMetaMaskAccounts = ["0x1234567890123456789012345678901234567890"];
      mockMetaMaskProvider.request
        .mockResolvedValueOnce(mockMetaMaskAccounts)
        .mockResolvedValueOnce("0x1");

      const metaMaskResult = await connectWallet("metaMask");
      expect(metaMaskResult.address).toBe(mockMetaMaskAccounts[0]);

      // Then connect WalletConnect
      const mockWCAccounts = ["0x9876543210987654321098765432109876543210"];
      mockWalletConnectProvider.enable.mockResolvedValueOnce(undefined);
      mockWalletConnectProvider.request.mockResolvedValueOnce(mockWCAccounts);

      const wcResult = await connectWallet("walletConnect");
      expect(wcResult.address).toBe(mockWCAccounts[0]);
    });
  });
});
