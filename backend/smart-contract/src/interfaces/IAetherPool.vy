# @version 0.3.10

interface IAetherPool:
    # --- State-Changing Functions ---
    def mint(to: address, amount0: uint256, amount1: uint256) -> uint256: nonpayable

    def burn(to: address, liquidity: uint256) -> (uint256, uint256): nonpayable

    def swap(amountIn: uint256, tokenIn: address, to: address) -> uint256: nonpayable

    # --- View Functions ---
    def getReserves() -> (uint256, uint256): view

    def factory() -> address: view

    def token0() -> address: view

    def token1() -> address: view

    def fee() -> uint24: view

    def reserve0() -> uint256: view

    def reserve1() -> uint256: view

    def totalSupply() -> uint256: view

    def initialized() -> bool: view

    def lock() -> bool: view # Reentrancy lock status
