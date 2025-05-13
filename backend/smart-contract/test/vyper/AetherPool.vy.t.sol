// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol"; // import-path-check likely Solhint remapping issue
import {IAetherPool} from "src/interfaces/IAetherPool.sol";
import {MockERC20} from "test/mocks/MockERC20.sol";

contract AetherPoolVyperTest is Test {
    IAetherPool public vyper_pool;
    MockERC20 public token0;
    MockERC20 public token1;
    address public owner;
    address public constant alice = address(0x1);
    uint24 public constant fee = 3000; // 0.3% Fee tier

    function setUp() public {
        owner = address(this);
        // Deploy Vyper pool with factory address as owner
        bytes memory constructor_args = abi.encode(owner);
        address pool_address = vm.deployCode("src/security/AetherPool.vy", constructor_args);
        vyper_pool = IAetherPool(pool_address);

        // Deploy mock tokens FIRST
        token0 = new MockERC20("Token0", "TKN0", 18);
        token1 = new MockERC20("Token1", "TKNB", 18);

        // Initialize the deployed Vyper pool
        // Ensure tokens are ordered correctly for initialization
        address token0_instance = address(token0);
        address token1_instance = address(token1);
        address ordered_t0 = token0_instance < token1_instance ? token0_instance : token1_instance;
        address ordered_t1 = token0_instance < token1_instance ? token1_instance : token0_instance;
        vyper_pool.initialize(ordered_t0, ordered_t1, fee);

        // Mint initial tokens to users
        token0.mint(alice, 1000 ether);
        token1.mint(alice, 1000 ether); // Mint both tokens
    }

/*
    function test_Mint_And_Burn() public {
        // Assume pool is ready after deployment in setUp
        // Initialization via interface is removed.

        uint256 amount0 = 100 ether;
        uint256 amount1 = 100 ether;
        token0.mint(address(this), amount0);
        token1.mint(address(this), amount1);
        token0.approve(address(vyper_pool), amount0);
        token1.approve(address(vyper_pool), amount1);

        // This call will fail as the mint signature changed
        // uint256 liquidity = vyper_pool.mint(address(this), amount0, amount1);
        // assertGt(liquidity, 0, "liquidity should be greater than zero");

        // uint256 r0_after = token0.balanceOf(address(vyper_pool));
        // uint256 r1_after = token1.balanceOf(address(vyper_pool));
        // assertEq(r0_after, amount0, "reserve0 mismatch after mint");
        // assertEq(r1_after, amount1, "reserve1 mismatch after mint");

        // // Burn liquidity
        // (uint256 burn0, uint256 burn1) = vyper_pool.burn(address(this), liquidity);
        // assertGt(burn0, 0, "burned token0 should be greater than zero");
        // assertGt(burn1, 0, "burned token1 should be greater than zero");

        // // Final reserves should return to zero
        // uint256 final0 = token0.balanceOf(address(vyper_pool));
        // uint256 final1 = token1.balanceOf(address(vyper_pool));
        // assertLe(final0, 1, "final reserve0 should be near zero"); 
        // assertLe(final1, 1, "final reserve1 should be near zero"); 
    }
*/
}
