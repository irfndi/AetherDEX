// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAetherPositionManager} from "../interfaces/IAetherPositionManager.sol";

contract AetherPositionManager is IAetherPositionManager, IUnlockCallback, ERC721, ReentrancyGuard {
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    enum Action {
        MINT,
        SINGLE_SIDED_MINT,
        REMOVE,
        REBALANCE
    }

    IPoolManager public immutable poolManager;
    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => Position position) private _positions;
    bool private _unlockActive;

    constructor(IPoolManager _poolManager) ERC721("Aether V4 Position", "AETH-LP") {
        poolManager = _poolManager;
    }

    // slither-disable-next-line write-after-write
    // slither-disable-next-line reentrancy-benign
    function mintPosition(MintPositionParams calldata params)
        external
        payable
        nonReentrant
        returns (uint256 tokenId, uint256 amount0, uint256 amount1)
    {
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        if (params.recipient == address(0)) revert ZeroRecipient();
        if (params.liquidity == 0) revert InvalidLiquidity();
        if (!params.poolKey.currency0.isAddressZero() && !params.poolKey.currency1.isAddressZero() && msg.value != 0) {
            revert UnexpectedNativeValue();
        }

        tokenId = _nextTokenId++;
        bytes32 salt = bytes32(tokenId);
        Position memory position = Position(params.poolKey, params.tickLower, params.tickUpper, params.liquidity, salt);
        uint256 balance0Before = _balanceBeforeCall(params.poolKey.currency0);
        uint256 balance1Before = _balanceBeforeCall(params.poolKey.currency1);
        _pullMaximums(params);
        // slither-disable-next-line write-after-write
        _unlockActive = true;
        bytes memory result = poolManager.unlock(abi.encode(Action.MINT, abi.encode(position, params)));
        _unlockActive = false;
        (amount0, amount1) = abi.decode(result, (uint256, uint256));
        if (amount0 > params.amount0Max || amount1 > params.amount1Max) revert AmountMaximumExceeded();

        _positions[tokenId] = position;
        _safeMint(params.recipient, tokenId);
        _refund(params.poolKey, params.recipient, balance0Before, balance1Before);
    }

    // PoolManager is the trusted unlock target; the balance snapshots are intentional settlement guards.
    // slither-disable-start reentrancy-balance
    // slither-disable-next-line reentrancy-benign
    function mintPositionSingleSided(SingleSidedMintParams calldata params)
        external
        nonReentrant
        returns (uint256 tokenId, uint256 amount0, uint256 amount1, uint256 amountOut)
    {
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        if (params.recipient == address(0)) revert ZeroRecipient();
        if (params.amountIn == 0 || params.swapAmountIn == 0 || params.swapAmountIn > params.amountIn) {
            revert InvalidLiquidity();
        }
        if (params.liquidity == 0 || params.tickLower >= params.tickUpper) revert InvalidLiquidity();
        if (params.poolKey.currency0.isAddressZero() || params.poolKey.currency1.isAddressZero()) {
            revert UnexpectedNativeValue();
        }
        tokenId = _nextTokenId++;
        Position memory position =
            Position(params.poolKey, params.tickLower, params.tickUpper, params.liquidity, bytes32(tokenId));
        uint256 balance0Before = _balanceBeforeCall(params.poolKey.currency0);
        uint256 balance1Before = _balanceBeforeCall(params.poolKey.currency1);
        Currency currencyIn = params.zeroForOne ? params.poolKey.currency0 : params.poolKey.currency1;
        IERC20(Currency.unwrap(currencyIn)).safeTransferFrom(msg.sender, address(this), params.amountIn);
        // slither-disable-next-line write-after-write
        _unlockActive = true;
        bytes memory result = poolManager.unlock(
            abi.encode(Action.SINGLE_SIDED_MINT, abi.encode(position, params, balance0Before, balance1Before))
        );
        _unlockActive = false;
        (amount0, amount1, amountOut) = abi.decode(result, (uint256, uint256, uint256));
        if (amountOut < params.minSwapAmountOut || amount0 < params.minAmount0 || amount1 < params.minAmount1) {
            revert SlippageExceeded();
        }
        _positions[tokenId] = position;
        _safeMint(params.recipient, tokenId);
        _refund(params.poolKey, params.recipient, balance0Before, balance1Before);
    }
    // slither-disable-end reentrancy-balance

    // slither-disable-next-line write-after-write
    function removeLiquidity(RemoveLiquidityParams calldata params)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        address positionOwner = _ownerOf(params.tokenId);
        if (!_isAuthorized(positionOwner, msg.sender, params.tokenId)) {
            _checkAuthorized(positionOwner, msg.sender, params.tokenId);
        }
        Position memory position = _positions[params.tokenId];
        if (params.liquidity == 0 || params.liquidity > position.liquidity) revert InvalidLiquidity();

        // slither-disable-next-line write-after-write
        _unlockActive = true;
        bytes memory result =
            poolManager.unlock(abi.encode(Action.REMOVE, abi.encode(position, params.liquidity, params.hookData)));
        _unlockActive = false;
        (amount0, amount1) = abi.decode(result, (uint256, uint256));
        if (amount0 < params.amount0Min || amount1 < params.amount1Min) revert SlippageExceeded();

        address recipient = ownerOf(params.tokenId);
        if (params.liquidity == position.liquidity) {
            delete _positions[params.tokenId];
            _burn(params.tokenId);
        } else {
            _positions[params.tokenId].liquidity -= params.liquidity;
        }
        _pay(position.poolKey, recipient, amount0, amount1);
    }

    // slither-disable-start reentrancy-balance,reentrancy-no-eth
    // slither-disable-next-line reentrancy-benign
    function rebalancePosition(RebalancePositionParams calldata params)
        external
        payable
        nonReentrant
        returns (uint256 closedAmount0, uint256 closedAmount1, uint256 usedAmount0, uint256 usedAmount1)
    {
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        if (params.liquidity == 0) revert InvalidLiquidity();
        if (params.tickLower >= params.tickUpper) revert InvalidLiquidity();
        address positionOwner = _ownerOf(params.tokenId);
        if (msg.sender != positionOwner) revert RebalanceOwnerOnly();
        Position memory position = _positions[params.tokenId];
        if (
            !position.poolKey.currency0.isAddressZero() && !position.poolKey.currency1.isAddressZero() && msg.value != 0
        ) {
            revert UnexpectedNativeValue();
        }

        uint256 balance0Before = _balanceBeforeCall(position.poolKey.currency0);
        uint256 balance1Before = _balanceBeforeCall(position.poolKey.currency1);
        // slither-disable-next-line write-after-write
        _unlockActive = true;
        bytes memory result = poolManager.unlock(
            abi.encode(Action.REBALANCE, abi.encode(position, params, balance0Before, balance1Before, positionOwner))
        );
        _unlockActive = false;
        (closedAmount0, closedAmount1, usedAmount0, usedAmount1) =
            abi.decode(result, (uint256, uint256, uint256, uint256));
        if (closedAmount0 < params.amount0Min || closedAmount1 < params.amount1Min) revert SlippageExceeded();

        _positions[params.tokenId] =
            Position(position.poolKey, params.tickLower, params.tickUpper, params.liquidity, position.salt);
        _refund(position.poolKey, positionOwner, balance0Before, balance1Before);
    }
    // slither-disable-end reentrancy-balance,reentrancy-no-eth

    function getPosition(uint256 tokenId) external view returns (Position memory) {
        return _positions[tokenId];
    }

    // slither-disable-next-line unused-return
    function unlockCallback(bytes calldata data)
        external
        override(IAetherPositionManager, IUnlockCallback)
        returns (bytes memory)
    {
        if (msg.sender != address(poolManager)) {
            revert InvalidCallbackCaller(msg.sender);
        }
        if (!_unlockActive) revert InvalidCallbackContext();
        (Action action, bytes memory actionData) = abi.decode(data, (Action, bytes));
        if (action == Action.MINT) {
            (Position memory position, MintPositionParams memory params) =
                abi.decode(actionData, (Position, MintPositionParams));
            (BalanceDelta delta,) = poolManager.modifyLiquidity(
                position.poolKey,
                ModifyLiquidityParams(
                    position.tickLower, position.tickUpper, int256(uint256(position.liquidity)), position.salt
                ),
                params.hookData
            );
            (uint256 amount0, uint256 amount1) = _settleOwed(position.poolKey, delta);
            return abi.encode(amount0, amount1);
        }
        if (action == Action.SINGLE_SIDED_MINT) {
            (Position memory position, SingleSidedMintParams memory params, uint256 balance0Before, uint256 balance1Before) =
                abi.decode(actionData, (Position, SingleSidedMintParams, uint256, uint256));
            SwapParams memory swapParams = SwapParams({
                zeroForOne: params.zeroForOne,
                amountSpecified: -int256(uint256(params.swapAmountIn)),
                sqrtPriceLimitX96: params.zeroForOne
                    ? _minSqrtPriceLimit()
                    : _maxSqrtPriceLimit()
            });
            BalanceDelta swapDelta = poolManager.swap(position.poolKey, swapParams, params.hookData);
            Currency currencyIn = params.zeroForOne ? position.poolKey.currency0 : position.poolKey.currency1;
            uint256 actualAmountIn = params.zeroForOne
                ? uint256(-int256(swapDelta.amount0()))
                : uint256(-int256(swapDelta.amount1()));
            if (actualAmountIn > params.swapAmountIn) revert AmountMaximumExceeded();
            _settleCallScoped(currencyIn, actualAmountIn, params.zeroForOne ? balance0Before : balance1Before);
            Currency currencyOut = params.zeroForOne ? position.poolKey.currency1 : position.poolKey.currency0;
            uint256 amountOut = params.zeroForOne
                ? uint256(int256(swapDelta.amount1()))
                : uint256(int256(swapDelta.amount0()));
            if (amountOut > 0) poolManager.take(currencyOut, address(this), amountOut);
            (BalanceDelta liquidityDelta,) = poolManager.modifyLiquidity(
                position.poolKey,
                ModifyLiquidityParams(position.tickLower, position.tickUpper, int256(uint256(position.liquidity)), position.salt),
                params.hookData
            );
            (uint256 amount0, uint256 amount1) = _settleCallScopedLiquidity(
                position.poolKey, liquidityDelta, balance0Before, balance1Before
            );
            return abi.encode(amount0, amount1, amountOut);
        }
        if (action == Action.REBALANCE) {
            (
                Position memory oldPosition,
                RebalancePositionParams memory params,
                uint256 balance0Before,
                uint256 balance1Before,
                address positionOwner
            ) = abi.decode(actionData, (Position, RebalancePositionParams, uint256, uint256, address));
            (BalanceDelta rebalanceRemoveDelta,) = poolManager.modifyLiquidity(
                oldPosition.poolKey,
                ModifyLiquidityParams(
                    oldPosition.tickLower,
                    oldPosition.tickUpper,
                    -int256(uint256(oldPosition.liquidity)),
                    oldPosition.salt
                ),
                params.hookData
            );
            uint256 closedAmount0 = uint256(int256(rebalanceRemoveDelta.amount0()));
            uint256 closedAmount1 = uint256(int256(rebalanceRemoveDelta.amount1()));
            if (closedAmount0 > 0) poolManager.take(oldPosition.poolKey.currency0, address(this), closedAmount0);
            if (closedAmount1 > 0) poolManager.take(oldPosition.poolKey.currency1, address(this), closedAmount1);

            (BalanceDelta addDelta,) = poolManager.modifyLiquidity(
                oldPosition.poolKey,
                ModifyLiquidityParams(
                    params.tickLower, params.tickUpper, int256(uint256(params.liquidity)), oldPosition.salt
                ),
                params.hookData
            );
            (uint256 usedAmount0, uint256 usedAmount1) = _settleRebalanceCallScoped(
                oldPosition.poolKey,
                addDelta,
                balance0Before,
                balance1Before,
                positionOwner,
                params.amount0Max,
                params.amount1Max
            );
            return abi.encode(closedAmount0, closedAmount1, usedAmount0, usedAmount1);
        }
        (Position memory removePosition, uint128 liquidity, bytes memory hookData) =
            abi.decode(actionData, (Position, uint128, bytes));
        (BalanceDelta removeDelta,) = poolManager.modifyLiquidity(
            removePosition.poolKey,
            ModifyLiquidityParams(
                removePosition.tickLower, removePosition.tickUpper, -int256(uint256(liquidity)), removePosition.salt
            ),
            hookData
        );
        uint256 received0 = uint256(int256(removeDelta.amount0()));
        uint256 received1 = uint256(int256(removeDelta.amount1()));
        if (received0 > 0) poolManager.take(removePosition.poolKey.currency0, address(this), received0);
        if (received1 > 0) poolManager.take(removePosition.poolKey.currency1, address(this), received1);
        return abi.encode(received0, received1);
    }

    function _settleOwed(PoolKey memory key, BalanceDelta delta) internal returns (uint256 amount0, uint256 amount1) {
        amount0 = uint256(-int256(delta.amount0()));
        amount1 = uint256(-int256(delta.amount1()));
        if (amount0 > 0) _settle(key.currency0, amount0);
        if (amount1 > 0) _settle(key.currency1, amount1);
    }

    function _settleOwedCallScoped(
        PoolKey memory key,
        BalanceDelta delta,
        uint256 balance0Before,
        uint256 balance1Before
    ) internal returns (uint256 amount0, uint256 amount1) {
        amount0 = uint256(-int256(delta.amount0()));
        amount1 = uint256(-int256(delta.amount1()));
        _settleCallScoped(key.currency0, amount0, balance0Before);
        _settleCallScoped(key.currency1, amount1, balance1Before);
    }

    function _settleCallScopedLiquidity(
        PoolKey memory key,
        BalanceDelta delta,
        uint256 balance0Before,
        uint256 balance1Before
    ) internal returns (uint256 amount0, uint256 amount1) {
        amount0 = uint256(-int256(delta.amount0()));
        amount1 = uint256(-int256(delta.amount1()));
        _settleCallScoped(key.currency0, amount0, balance0Before);
        _settleCallScoped(key.currency1, amount1, balance1Before);
    }

    function _settleRebalanceCallScoped(
        PoolKey memory key,
        BalanceDelta delta,
        uint256 balance0Before,
        uint256 balance1Before,
        address positionOwner,
        uint256 amount0Max,
        uint256 amount1Max
    ) internal returns (uint256 amount0, uint256 amount1) {
        amount0 = uint256(-int256(delta.amount0()));
        amount1 = uint256(-int256(delta.amount1()));
        if (amount0 > amount0Max || amount1 > amount1Max) revert AmountMaximumExceeded();
        _pullRebalanceShortfall(key.currency0, amount0, balance0Before, positionOwner, amount0Max);
        _pullRebalanceShortfall(key.currency1, amount1, balance1Before, positionOwner, amount1Max);
        if (amount0 > 0) _settle(key.currency0, amount0);
        if (amount1 > 0) _settle(key.currency1, amount1);
    }

    function _pullRebalanceShortfall(
        Currency currency,
        uint256 required,
        uint256 balanceBefore,
        address positionOwner,
        uint256 amountMax
    ) internal {
        uint256 balance = _balanceOf(currency);
        uint256 available = balance > balanceBefore ? balance - balanceBefore : 0;
        if (available >= required) return;
        uint256 shortfall = required - available;
        if (shortfall > amountMax || currency.isAddressZero()) revert AmountMaximumExceeded();
        // positionOwner is the authorized NFT owner checked by rebalancePosition; the allowance is user-controlled.
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(Currency.unwrap(currency)).safeTransferFrom(positionOwner, address(this), shortfall);
    }

    function _settleCallScoped(Currency currency, uint256 amount, uint256 balanceBefore) internal {
        if (amount == 0) return;
        uint256 balance = _balanceOf(currency);
        if (balance < balanceBefore || balance - balanceBefore < amount) revert InsufficientCallBalance();
        _settle(currency, amount);
    }

    // slither-disable-next-line unused-return
    function _settle(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        if (currency.isAddressZero()) {
            poolManager.settle{value: amount}();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
    }

    function _pullMaximums(MintPositionParams memory params) internal {
        if (params.poolKey.currency0.isAddressZero()) {
            if (msg.value < params.amount0Max) revert AmountMaximumExceeded();
        } else {
            IERC20(Currency.unwrap(params.poolKey.currency0))
                .safeTransferFrom(msg.sender, address(this), params.amount0Max);
        }
        if (params.poolKey.currency1.isAddressZero()) {
            if (msg.value < params.amount1Max) revert AmountMaximumExceeded();
        } else {
            IERC20(Currency.unwrap(params.poolKey.currency1))
                .safeTransferFrom(msg.sender, address(this), params.amount1Max);
        }
    }

    function _refund(PoolKey memory key, address recipient, uint256 balance0Before, uint256 balance1Before) internal {
        _refundCurrency(key.currency0, recipient, balance0Before);
        _refundCurrency(key.currency1, recipient, balance1Before);
    }

    // slither-disable-next-line incorrect-equality
    function _refundCurrency(Currency currency, address recipient, uint256 balanceBefore) internal {
        uint256 balanceAfter = _balanceOf(currency);
        uint256 amount = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;
        if (amount == 0) return;
        if (currency.isAddressZero()) {
            (bool success,) = payable(recipient).call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(recipient, amount);
        }
    }

    function _pay(PoolKey memory key, address recipient, uint256 amount0, uint256 amount1) internal {
        _payCurrency(key.currency0, recipient, amount0);
        _payCurrency(key.currency1, recipient, amount1);
    }

    // slither-disable-next-line arbitrary-send-eth
    function _payCurrency(Currency currency, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        if (currency.isAddressZero()) {
            (bool success,) = payable(recipient).call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(recipient, amount);
        }
    }

    function _balanceOf(Currency currency) internal view returns (uint256) {
        return
            currency.isAddressZero()
                ? address(this).balance
                : IERC20(Currency.unwrap(currency)).balanceOf(address(this));
    }

    function _balanceBeforeCall(Currency currency) internal view returns (uint256) {
        uint256 balance = _balanceOf(currency);
        return currency.isAddressZero() ? balance - msg.value : balance;
    }

    function _minSqrtPriceLimit() internal pure returns (uint160) {
        return TickMath.MIN_SQRT_PRICE + 1;
    }

    function _maxSqrtPriceLimit() internal pure returns (uint160) {
        return TickMath.MAX_SQRT_PRICE - 1;
    }

    receive() external payable {}
}
