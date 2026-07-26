// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "forge-std/Test.sol";
import {AetherV3ZapExecutor, IV3PositionManager, IV3SwapRouter} from "src/router/AetherV3ZapExecutor.sol";
import {Errors} from "src/lib/Errors.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract V3ZapToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract V3ZapSwapRouterMock is IV3SwapRouter {
    uint256 public amountOut;
    address public lastTokenIn;
    address public lastTokenOut;
    uint256 public lastAmountIn;

    function setAmountOut(uint256 value) external {
        amountOut = value;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256) {
        lastTokenIn = params.tokenIn;
        lastTokenOut = params.tokenOut;
        lastAmountIn = params.amountIn;
        ERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        ERC20(params.tokenOut).transfer(params.recipient, amountOut);
        return amountOut;
    }
}

contract V3ZapPositionManagerMock is IV3PositionManager {
    uint256 public nextTokenId = 1;
    uint256 public lastAmount0Desired;
    uint256 public lastAmount1Desired;
    address public lastRecipient;

    function mint(MintParams calldata params)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        lastAmount0Desired = params.amount0Desired;
        lastAmount1Desired = params.amount1Desired;
        lastRecipient = params.recipient;
        ERC20(params.token0).transferFrom(msg.sender, address(this), params.amount0Desired);
        ERC20(params.token1).transferFrom(msg.sender, address(this), params.amount1Desired);
        tokenId = nextTokenId++;
        liquidity = 1e18;
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
    }
}

contract AetherV3ZapExecutorTest is Test {
    V3ZapToken internal token0;
    V3ZapToken internal token1;
    V3ZapSwapRouterMock internal swapRouter;
    V3ZapPositionManagerMock internal positionManager;
    AetherV3ZapExecutor internal executor;
    address internal user = makeAddr("user");

    function setUp() public {
        token0 = new V3ZapToken("Token 0", "T0");
        token1 = new V3ZapToken("Token 1", "T1");
        if (address(token1) < address(token0)) {
            (token0, token1) = (token1, token0);
        }
        swapRouter = new V3ZapSwapRouterMock();
        positionManager = new V3ZapPositionManagerMock();
        executor = new AetherV3ZapExecutor(swapRouter, positionManager);
        token0.mint(user, 100 ether);
        token0.mint(address(swapRouter), 100 ether);
        token1.mint(address(swapRouter), 100 ether);
        vm.prank(user);
        token0.approve(address(executor), type(uint256).max);
    }

    function test_zapFromToken0SwapsMintsAndRefunds() public {
        swapRouter.setAmountOut(35 ether);
        uint256 token0Before = token0.balanceOf(user);
        uint256 token1Before = token1.balanceOf(user);

        vm.prank(user);
        (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1, uint256 amountOut) =
            executor.zap(_params(address(token0)));

        assertEq(tokenId, 1);
        assertEq(liquidity, 1e18);
        assertEq(amount0, 60 ether);
        assertEq(amount1, 35 ether);
        assertEq(amountOut, 35 ether);
        assertEq(positionManager.lastAmount0Desired(), 60 ether);
        assertEq(positionManager.lastAmount1Desired(), 35 ether);
        assertEq(positionManager.lastRecipient(), user);
        assertEq(token0.balanceOf(user), token0Before - 100 ether);
        assertEq(token1.balanceOf(user), token1Before);
        assertEq(token0.balanceOf(address(executor)), 0);
        assertEq(token1.balanceOf(address(executor)), 0);
        assertEq(swapRouter.lastTokenIn(), address(token0));
        assertEq(swapRouter.lastTokenOut(), address(token1));
        assertEq(swapRouter.lastAmountIn(), 40 ether);
    }

    function test_zapFromToken1UsesReversedAmounts() public {
        token1.mint(user, 100 ether);
        vm.prank(user);
        token1.approve(address(executor), type(uint256).max);
        swapRouter.setAmountOut(25 ether);

        vm.prank(user);
        executor.zap(_params(address(token1)));

        assertEq(positionManager.lastAmount0Desired(), 25 ether);
        assertEq(positionManager.lastAmount1Desired(), 60 ether);
        assertEq(swapRouter.lastTokenIn(), address(token1));
        assertEq(swapRouter.lastTokenOut(), address(token0));
    }

    function test_zapRevertsForOutputBelowMinimum() public {
        swapRouter.setAmountOut(9 ether);
        AetherV3ZapExecutor.SingleSidedZapParams memory params = _params(address(token0));
        params.minSwapAmountOut = 10 ether;

        vm.expectRevert(abi.encodeWithSelector(Errors.SlippageExceeded.selector, 10 ether, 9 ether));
        vm.prank(user);
        executor.zap(params);
    }

    function test_zapRefundsPreExistingDustWithoutGriefing() public {
        token0.mint(address(executor), 1);

        swapRouter.setAmountOut(35 ether);
        vm.prank(user);
        executor.zap(_params(address(token0)));

        assertEq(token0.balanceOf(user), 1);
        assertEq(token0.balanceOf(address(executor)), 0);
        assertEq(token1.balanceOf(address(executor)), 0);
    }

    function test_zapRevertsForExpiredDeadline() public {
        AetherV3ZapExecutor.SingleSidedZapParams memory params = _params(address(token0));
        params.deadline = block.timestamp - 1;

        vm.expectRevert(Errors.DeadlineExpired.selector);
        vm.prank(user);
        executor.zap(params);
    }

    function test_zapRevertsForInvalidFeeAndRange() public {
        AetherV3ZapExecutor.SingleSidedZapParams memory params = _params(address(token0));
        params.fee = 1_000_001;
        vm.expectRevert(Errors.InvalidFee.selector);
        vm.prank(user);
        executor.zap(params);

        params = _params(address(token0));
        params.tickUpper = params.tickLower;
        vm.expectRevert(Errors.InvalidTickRange.selector);
        vm.prank(user);
        executor.zap(params);
    }

    function _params(address tokenIn) private view returns (AetherV3ZapExecutor.SingleSidedZapParams memory) {
        return AetherV3ZapExecutor.SingleSidedZapParams({
            token0: address(token0),
            token1: address(token1),
            tokenIn: tokenIn,
            fee: 3_000,
            tickLower: -600,
            tickUpper: 600,
            amountIn: 100 ether,
            swapAmountIn: 40 ether,
            minSwapAmountOut: 10 ether,
            amount0Min: 1,
            amount1Min: 1,
            sqrtPriceLimitX96: 0,
            deadline: block.timestamp + 1 hours
        });
    }
}
