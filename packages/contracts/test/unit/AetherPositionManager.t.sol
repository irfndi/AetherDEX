// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "forge-std/Test.sol";
import {AetherPositionManager} from "src/position/AetherPositionManager.sol";
import {IAetherPositionManager} from "src/interfaces/IAetherPositionManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract AetherPositionManagerTest is Test {
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint128 internal constant LIQUIDITY = 1 ether;
    uint256 internal constant MAX_AMOUNT = 1 ether;

    PositionPoolManagerMock internal mockPoolManager;
    IPoolManager internal poolManager;
    AetherPositionManager internal positionManager;
    PositionToken internal tokenA;
    PositionToken internal tokenB;
    PositionToken internal token0;
    PositionToken internal token1;
    PoolKey internal poolKey;

    address internal user = makeAddr("user");
    address internal operator = makeAddr("operator");
    address internal newOwner = makeAddr("newOwner");
    address internal attacker = makeAddr("attacker");

    function setUp() public {
        mockPoolManager = new PositionPoolManagerMock();
        poolManager = IPoolManager(address(mockPoolManager));
        positionManager = new AetherPositionManager(poolManager);
        tokenA = new PositionToken("Token A", "TKA");
        tokenB = new PositionToken("Token B", "TKB");

        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        mockPoolManager.initialize(poolKey, SQRT_PRICE_1_1);

        token0.mint(user, 100 ether);
        token1.mint(user, 100 ether);
        vm.startPrank(user);
        token0.approve(address(positionManager), type(uint256).max);
        token1.approve(address(positionManager), type(uint256).max);
        vm.stopPrank();
    }

    function test_mintPosition_mintsReceiptAndMakesManagerCorePositionOwner() public {
        uint256 balance0Before = token0.balanceOf(user);
        uint256 balance1Before = token1.balanceOf(user);

        vm.prank(user);
        (uint256 tokenId, uint256 amount0, uint256 amount1) = positionManager.mintPosition(_mintParams(user));

        assertEq(tokenId, 1);
        assertEq(positionManager.ownerOf(tokenId), user);
        assertGt(amount0, 0);
        assertGt(amount1, 0);
        assertLe(amount0, MAX_AMOUNT);
        assertLe(amount1, MAX_AMOUNT);
        assertEq(token0.balanceOf(user), balance0Before - amount0);
        assertEq(token1.balanceOf(user), balance1Before - amount1);

        IAetherPositionManager.Position memory position = positionManager.getPosition(tokenId);
        assertEq(position.tickLower, -60);
        assertEq(position.tickUpper, 60);
        assertEq(position.liquidity, LIQUIDITY);
        assertEq(position.salt, bytes32(tokenId));

        uint128 managerLiquidity = mockPoolManager.positionLiquidity(
            poolKey, address(positionManager), position.tickLower, position.tickUpper, position.salt
        );
        uint128 userLiquidity =
            mockPoolManager.positionLiquidity(poolKey, user, position.tickLower, position.tickUpper, position.salt);

        assertEq(managerLiquidity, LIQUIDITY);
        assertEq(userLiquidity, 0);
        assertEq(mockPoolManager.lastModifyLiquidityCaller(), address(positionManager));
        assertEq(mockPoolManager.nonzeroDeltaCount(), 0);
    }

    function test_mintPositionSingleSided_mintsReceiptAfterSwapAndLiquidity() public {
        mockPoolManager.setSwapDelta(toBalanceDelta(-int128(0.4 ether), int128(0.3 ether)));
        token1.mint(address(mockPoolManager), 1 ether);
        vm.prank(user);
        (uint256 tokenId, uint256 amount0, uint256 amount1, uint256 amountOut) =
            positionManager.mintPositionSingleSided(
                IAetherPositionManager.SingleSidedMintParams({
                    poolKey: poolKey,
                    tickLower: -60,
                    tickUpper: 60,
                    liquidity: LIQUIDITY,
                    zeroForOne: true,
                    amountIn: 1 ether,
                    swapAmountIn: 0.4 ether,
                    minSwapAmountOut: 0.29 ether,
                    minAmount0: 0,
                    minAmount1: 0,
                    recipient: user,
                    deadline: block.timestamp + 100,
                    hookData: ""
                })
            );

        assertEq(tokenId, 1);
        assertEq(amountOut, 0.3 ether);
        assertGt(amount0, 0);
        assertGt(amount1, 0);
        assertEq(positionManager.ownerOf(tokenId), user);
        assertEq(
            mockPoolManager.positionLiquidity(poolKey, address(positionManager), -60, 60, bytes32(tokenId)), LIQUIDITY
        );
    }

    function test_removeLiquidity_revertsForUnapprovedCaller() public {
        uint256 tokenId = _mintForUser();

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, attacker, tokenId));
        vm.prank(attacker);
        positionManager.removeLiquidity(_removeParams(tokenId, LIQUIDITY));
    }

    function test_removeLiquidity_allowsApprovedOperatorAndPaysReceiptOwner() public {
        uint256 tokenId = _mintForUser();
        uint256 ownerBalance0Before = token0.balanceOf(user);
        uint256 ownerBalance1Before = token1.balanceOf(user);
        uint256 operatorBalance0Before = token0.balanceOf(operator);
        uint256 operatorBalance1Before = token1.balanceOf(operator);

        vm.prank(user);
        positionManager.approve(operator, tokenId);

        vm.prank(operator);
        (uint256 amount0, uint256 amount1) = positionManager.removeLiquidity(_removeParams(tokenId, LIQUIDITY));

        assertGt(amount0, 0);
        assertGt(amount1, 0);
        assertEq(token0.balanceOf(user), ownerBalance0Before + amount0);
        assertEq(token1.balanceOf(user), ownerBalance1Before + amount1);
        assertEq(token0.balanceOf(operator), operatorBalance0Before);
        assertEq(token1.balanceOf(operator), operatorBalance1Before);

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, tokenId));
        positionManager.ownerOf(tokenId);
    }

    function test_removeLiquidity_partialRemovalKeepsReceiptAndTracksCoreLiquidity() public {
        uint256 tokenId = _mintForUser();
        uint128 removedLiquidity = LIQUIDITY / 4;

        vm.prank(user);
        positionManager.removeLiquidity(_removeParams(tokenId, removedLiquidity));

        IAetherPositionManager.Position memory position = positionManager.getPosition(tokenId);
        assertEq(positionManager.ownerOf(tokenId), user);
        assertEq(position.liquidity, LIQUIDITY - removedLiquidity);

        uint128 coreLiquidity = mockPoolManager.positionLiquidity(
            poolKey, address(positionManager), position.tickLower, position.tickUpper, position.salt
        );
        assertEq(coreLiquidity, LIQUIDITY - removedLiquidity);
    }

    function test_rebalancePosition_closesAndRemintsAtomically() public {
        uint256 tokenId = _mintForUser();
        token0.mint(address(positionManager), 7);
        token1.mint(address(positionManager), 13);
        vm.startPrank(user);
        token0.transfer(attacker, token0.balanceOf(user));
        token1.transfer(attacker, token1.balanceOf(user));
        vm.stopPrank();
        uint256 balance0Before = token0.balanceOf(user);
        uint256 balance1Before = token1.balanceOf(user);

        vm.prank(user);
        (uint256 closed0, uint256 closed1, uint256 used0, uint256 used1) =
            positionManager.rebalancePosition(_rebalanceParams(tokenId));

        assertGt(closed0, 0);
        assertGt(closed1, 0);
        assertGt(used0, 0);
        assertGt(used1, 0);
        assertEq(positionManager.ownerOf(tokenId), user);
        IAetherPositionManager.Position memory position = positionManager.getPosition(tokenId);
        assertEq(position.tickLower, -120);
        assertEq(position.tickUpper, 120);
        assertEq(position.liquidity, LIQUIDITY);
        assertEq(mockPoolManager.positionLiquidity(poolKey, address(positionManager), -60, 60, bytes32(tokenId)), 0);
        assertEq(
            mockPoolManager.positionLiquidity(poolKey, address(positionManager), -120, 120, bytes32(tokenId)), LIQUIDITY
        );
        assertEq(token0.balanceOf(user), balance0Before + closed0 - used0);
        assertEq(token1.balanceOf(user), balance1Before + closed1 - used1);
        assertEq(token0.balanceOf(address(positionManager)), 7);
        assertEq(token1.balanceOf(address(positionManager)), 13);
    }

    function test_rebalancePosition_revertsWhenTotalSpendExceedsMaximumDespiteClosedProceeds() public {
        uint256 tokenId = _mintForUser();
        IAetherPositionManager.RebalancePositionParams memory params = _rebalanceParams(tokenId);
        params.amount0Max = LIQUIDITY / 1000 - 1;
        params.amount1Max = LIQUIDITY / 1000 - 1;

        vm.expectRevert(IAetherPositionManager.AmountMaximumExceeded.selector);
        vm.prank(user);
        positionManager.rebalancePosition(params);
    }

    function test_rebalancePosition_revertsForUnapprovedCaller() public {
        uint256 tokenId = _mintForUser();

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, attacker, tokenId));
        vm.prank(attacker);
        positionManager.rebalancePosition(_rebalanceParams(tokenId));
    }

    function test_rebalancePosition_revertsForInvertedRange() public {
        uint256 tokenId = _mintForUser();
        IAetherPositionManager.RebalancePositionParams memory params = _rebalanceParams(tokenId);
        params.tickLower = 120;
        params.tickUpper = -120;

        vm.expectRevert(IAetherPositionManager.InvalidLiquidity.selector);
        vm.prank(user);
        positionManager.rebalancePosition(params);
    }

    function test_rebalancePosition_revertsWhenDeadlineExpired() public {
        uint256 tokenId = _mintForUser();
        IAetherPositionManager.RebalancePositionParams memory params = _rebalanceParams(tokenId);
        params.deadline = block.timestamp - 1;

        vm.expectRevert(IAetherPositionManager.DeadlineExpired.selector);
        vm.prank(user);
        positionManager.rebalancePosition(params);
    }

    function test_rebalancePosition_revertsWhenClosedAmountIsBelowMinimum() public {
        uint256 tokenId = _mintForUser();
        IAetherPositionManager.RebalancePositionParams memory params = _rebalanceParams(tokenId);
        params.amount0Min = MAX_AMOUNT;

        vm.expectRevert(IAetherPositionManager.SlippageExceeded.selector);
        vm.prank(user);
        positionManager.rebalancePosition(params);
    }

    function test_transferredReceiptMovesRemovalAuthorityAndProceeds() public {
        uint256 tokenId = _mintForUser();

        vm.prank(user);
        positionManager.transferFrom(user, newOwner, tokenId);

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, user, tokenId));
        vm.prank(user);
        positionManager.removeLiquidity(_removeParams(tokenId, LIQUIDITY));

        uint256 newOwnerBalance0Before = token0.balanceOf(newOwner);
        uint256 newOwnerBalance1Before = token1.balanceOf(newOwner);
        vm.prank(newOwner);
        (uint256 amount0, uint256 amount1) = positionManager.removeLiquidity(_removeParams(tokenId, LIQUIDITY));

        assertEq(token0.balanceOf(newOwner), newOwnerBalance0Before + amount0);
        assertEq(token1.balanceOf(newOwner), newOwnerBalance1Before + amount1);
    }

    function test_unlockCallback_rejectsNonPoolManagerAndInactivePoolManagerCalls() public {
        bytes memory callbackData = abi.encode(uint8(0), bytes(""));

        vm.expectRevert(abi.encodeWithSelector(IAetherPositionManager.InvalidCallbackCaller.selector, address(this)));
        positionManager.unlockCallback(callbackData);

        vm.expectRevert(IAetherPositionManager.InvalidCallbackContext.selector);
        vm.prank(address(poolManager));
        positionManager.unlockCallback(callbackData);
    }

    function test_mintPosition_revertsWhenPoolRequiresMoreThanMaximum() public {
        IAetherPositionManager.MintPositionParams memory params = _mintParams(user);
        params.amount0Max = 1;
        params.amount1Max = 1;

        vm.expectRevert();
        vm.prank(user);
        positionManager.mintPosition(params);
    }

    function test_safeMintCallbackCannotReenterRemoval() public {
        ReentrantReceiptReceiver receiver = new ReentrantReceiptReceiver(positionManager, LIQUIDITY);
        token0.mint(address(receiver), 100 ether);
        token1.mint(address(receiver), 100 ether);
        receiver.approveToken(token0);
        receiver.approveToken(token1);

        IAetherPositionManager.MintPositionParams memory params = _mintParams(address(receiver));
        uint256 tokenId = receiver.mintPosition(params);

        assertTrue(receiver.reentryAttempted());
        assertEq(receiver.reentryRevertSelector(), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(positionManager.ownerOf(tokenId), address(receiver));
        assertEq(positionManager.getPosition(tokenId).liquidity, LIQUIDITY);
    }

    function test_nativeCurrencyPositionSettlesAndRefundsThroughUnlock() public {
        PositionToken nativePairToken = new PositionToken("Native Pair", "NATIVE");
        PoolKey memory nativePoolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(nativePairToken)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        poolManager.initialize(nativePoolKey, SQRT_PRICE_1_1);

        nativePairToken.mint(user, 100 ether);
        vm.prank(user);
        nativePairToken.approve(address(positionManager), type(uint256).max);
        vm.deal(user, 100 ether);
        uint256 nativeBalanceBefore = user.balance;

        IAetherPositionManager.MintPositionParams memory params = IAetherPositionManager.MintPositionParams({
            poolKey: nativePoolKey,
            tickLower: -60,
            tickUpper: 60,
            liquidity: LIQUIDITY,
            amount0Max: MAX_AMOUNT,
            amount1Max: MAX_AMOUNT,
            recipient: user,
            deadline: block.timestamp + 1,
            hookData: ""
        });

        vm.prank(user);
        (uint256 tokenId, uint256 amount0,) = positionManager.mintPosition{value: MAX_AMOUNT}(params);

        assertGt(amount0, 0);
        assertEq(user.balance, nativeBalanceBefore - amount0);
        assertEq(address(positionManager).balance, 0);

        uint256 balanceBeforeRemoval = user.balance;
        vm.prank(user);
        (uint256 received0,) = positionManager.removeLiquidity(_removeParams(tokenId, LIQUIDITY));

        assertGt(received0, 0);
        assertEq(user.balance, balanceBeforeRemoval + received0);
    }

    function _mintForUser() internal returns (uint256 tokenId) {
        vm.prank(user);
        (tokenId,,) = positionManager.mintPosition(_mintParams(user));
    }

    function _mintParams(address recipient) internal view returns (IAetherPositionManager.MintPositionParams memory) {
        return IAetherPositionManager.MintPositionParams({
            poolKey: poolKey,
            tickLower: -60,
            tickUpper: 60,
            liquidity: LIQUIDITY,
            amount0Max: MAX_AMOUNT,
            amount1Max: MAX_AMOUNT,
            recipient: recipient,
            deadline: block.timestamp + 1,
            hookData: ""
        });
    }

    function _removeParams(uint256 tokenId, uint128 liquidity)
        internal
        view
        returns (IAetherPositionManager.RemoveLiquidityParams memory)
    {
        return IAetherPositionManager.RemoveLiquidityParams({
            tokenId: tokenId,
            liquidity: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1,
            hookData: ""
        });
    }

    function _rebalanceParams(uint256 tokenId)
        internal
        view
        returns (IAetherPositionManager.RebalancePositionParams memory)
    {
        return IAetherPositionManager.RebalancePositionParams({
            tokenId: tokenId,
            tickLower: -120,
            tickUpper: 120,
            liquidity: LIQUIDITY,
            amount0Max: MAX_AMOUNT,
            amount1Max: MAX_AMOUNT,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1,
            hookData: ""
        });
    }
}

contract ReentrantReceiptReceiver is IERC721Receiver {
    IAetherPositionManager internal immutable positionManager;
    uint128 internal immutable liquidity;

    bool public reentryAttempted;
    bytes4 public reentryRevertSelector;

    constructor(IAetherPositionManager _positionManager, uint128 _liquidity) {
        positionManager = _positionManager;
        liquidity = _liquidity;
    }

    function approveToken(PositionToken token) external {
        token.approve(address(positionManager), type(uint256).max);
    }

    function mintPosition(IAetherPositionManager.MintPositionParams memory params)
        external
        payable
        returns (uint256 tokenId)
    {
        (tokenId,,) = positionManager.mintPosition{value: msg.value}(params);
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        reentryAttempted = true;
        IAetherPositionManager.RemoveLiquidityParams memory params = IAetherPositionManager.RemoveLiquidityParams({
            tokenId: tokenId,
            liquidity: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp,
            hookData: ""
        });

        try positionManager.removeLiquidity(params) {
            reentryRevertSelector = bytes4(0);
        } catch (bytes memory reason) {
            if (reason.length >= 4) {
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(reason, 0x20))
                }
                reentryRevertSelector = selector;
            }
        }

        return IERC721Receiver.onERC721Received.selector;
    }
}

contract PositionToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Strict V4 unlock harness for the position-manager unit tests.
/// @dev Models caller-keyed positions and rejects unlock completion while any currency delta remains unsettled.
contract PositionPoolManagerMock {
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    error AlreadyUnlocked();
    error ManagerLocked();
    error CurrencyNotSettled();
    error InsufficientPositionLiquidity();
    error InsufficientCredit();
    error SettlementExceedsDebt();
    error NativeTransferFailed();
    error InvalidSwapAmount();

    bool internal unlocked;
    Currency internal syncedCurrency;
    uint256 internal syncedBalance;
    int256 public nonzeroDeltaCount;
    address public lastModifyLiquidityCaller;
    BalanceDelta internal configuredSwapDelta;

    mapping(bytes32 positionKey => uint128 liquidity) internal positions;
    mapping(address account => mapping(Currency currency => int256 delta)) internal currencyDeltas;

    function initialize(PoolKey memory, uint160) external pure returns (int24) {
        return 0;
    }

    function setSwapDelta(BalanceDelta delta) external {
        configuredSwapDelta = delta;
    }

    function swap(PoolKey memory key, SwapParams memory params, bytes calldata)
        external
        returns (BalanceDelta delta)
    {
        if (!unlocked) revert ManagerLocked();
        if (params.amountSpecified >= 0) revert InvalidSwapAmount();
        delta = configuredSwapDelta;
        Currency input = params.zeroForOne ? key.currency0 : key.currency1;
        Currency output = params.zeroForOne ? key.currency1 : key.currency0;
        uint256 amountIn = params.zeroForOne ? uint256(-int256(delta.amount0())) : uint256(-int256(delta.amount1()));
        uint256 amountOut = params.zeroForOne ? uint256(int256(delta.amount1())) : uint256(int256(delta.amount0()));
        _accountDelta(msg.sender, input, -int256(amountIn));
        _accountDelta(msg.sender, output, int256(amountOut));
    }

    function unlock(bytes calldata data) external returns (bytes memory result) {
        if (unlocked) revert AlreadyUnlocked();
        unlocked = true;
        result = IUnlockCallback(msg.sender).unlockCallback(data);
        if (nonzeroDeltaCount != 0) revert CurrencyNotSettled();
        unlocked = false;
    }

    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata)
        external
        returns (BalanceDelta callerDelta, BalanceDelta feesAccrued)
    {
        if (!unlocked) revert ManagerLocked();
        lastModifyLiquidityCaller = msg.sender;

        bytes32 positionKey = _positionKey(key, msg.sender, params.tickLower, params.tickUpper, params.salt);
        uint256 absoluteLiquidity =
            params.liquidityDelta < 0 ? uint256(-params.liquidityDelta) : uint256(params.liquidityDelta);
        uint256 tokenAmount = absoluteLiquidity / 1000;

        if (params.liquidityDelta > 0) {
            positions[positionKey] += uint128(absoluteLiquidity);
            _accountDelta(msg.sender, key.currency0, -int256(tokenAmount));
            _accountDelta(msg.sender, key.currency1, -int256(tokenAmount));
            callerDelta = toBalanceDelta(-int128(int256(tokenAmount)), -int128(int256(tokenAmount)));
        } else {
            uint128 currentLiquidity = positions[positionKey];
            if (absoluteLiquidity > currentLiquidity) revert InsufficientPositionLiquidity();
            positions[positionKey] = currentLiquidity - uint128(absoluteLiquidity);
            _accountDelta(msg.sender, key.currency0, int256(tokenAmount));
            _accountDelta(msg.sender, key.currency1, int256(tokenAmount));
            callerDelta = toBalanceDelta(int128(int256(tokenAmount)), int128(int256(tokenAmount)));
        }

        feesAccrued = BalanceDelta.wrap(0);
    }

    function sync(Currency currency) external {
        if (!unlocked) revert ManagerLocked();
        syncedCurrency = currency;
        syncedBalance = currency.balanceOfSelf();
    }

    function settle() external payable returns (uint256 paid) {
        if (!unlocked) revert ManagerLocked();
        Currency currency;
        if (msg.value > 0) {
            currency = Currency.wrap(address(0));
            paid = msg.value;
        } else {
            currency = syncedCurrency;
            paid = currency.balanceOfSelf() - syncedBalance;
        }

        int256 debt = currencyDeltas[msg.sender][currency];
        if (debt >= 0 || paid > uint256(-debt)) revert SettlementExceedsDebt();
        _accountDelta(msg.sender, currency, int256(paid));
    }

    function take(Currency currency, address to, uint256 amount) external {
        if (!unlocked) revert ManagerLocked();
        int256 credit = currencyDeltas[msg.sender][currency];
        if (credit < 0 || amount > uint256(credit)) revert InsufficientCredit();
        _accountDelta(msg.sender, currency, -int256(amount));

        if (currency.isAddressZero()) {
            (bool success,) = payable(to).call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(to, amount);
        }
    }

    function positionLiquidity(PoolKey memory key, address owner, int24 tickLower, int24 tickUpper, bytes32 salt)
        external
        view
        returns (uint128)
    {
        return positions[_positionKey(key, owner, tickLower, tickUpper, salt)];
    }

    function _accountDelta(address account, Currency currency, int256 change) internal {
        int256 previous = currencyDeltas[account][currency];
        int256 next = previous + change;
        if (previous == 0 && next != 0) {
            ++nonzeroDeltaCount;
        } else if (previous != 0 && next == 0) {
            --nonzeroDeltaCount;
        }
        currencyDeltas[account][currency] = next;
    }

    function _positionKey(PoolKey memory key, address owner, int24 tickLower, int24 tickUpper, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(key, owner, tickLower, tickUpper, salt));
    }

    receive() external payable {}
}
