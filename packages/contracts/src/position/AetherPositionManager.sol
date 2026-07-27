// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
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
        REMOVE,
        REBALANCE
    }

    IPoolManager public immutable poolManager;
    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => Position position) private _positions;
    // Reentrancy guard flag: set true before each poolManager.unlock and false after, and read inside
    // unlockCallback. The true→false pair around every unlock is intentional, not a redundant write.
    // slither-disable-next-line write-after-write
    bool private _unlockActive;

    constructor(IPoolManager _poolManager) ERC721("Aether V4 Position", "AETH-LP") {
        poolManager = _poolManager;
    }

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
        _unlockActive = true;
        bytes memory result = poolManager.unlock(abi.encode(Action.MINT, abi.encode(position, params)));
        _unlockActive = false;
        (amount0, amount1) = abi.decode(result, (uint256, uint256));
        if (amount0 > params.amount0Max || amount1 > params.amount1Max) revert AmountMaximumExceeded();

        _positions[tokenId] = position;
        _safeMint(params.recipient, tokenId);
        _refund(params.poolKey, params.recipient, balance0Before, balance1Before);
    }

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
        if (!_isAuthorized(positionOwner, msg.sender, params.tokenId)) {
            _checkAuthorized(positionOwner, msg.sender, params.tokenId);
        }
        Position memory position = _positions[params.tokenId];
        if (
            !position.poolKey.currency0.isAddressZero() && !position.poolKey.currency1.isAddressZero() && msg.value != 0
        ) {
            revert UnexpectedNativeValue();
        }

        uint256 balance0Before = _balanceBeforeCall(position.poolKey.currency0);
        uint256 balance1Before = _balanceBeforeCall(position.poolKey.currency1);
        _pullMaximums(
            MintPositionParams({
                poolKey: position.poolKey,
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                liquidity: params.liquidity,
                amount0Max: params.amount0Max,
                amount1Max: params.amount1Max,
                recipient: positionOwner,
                deadline: params.deadline,
                hookData: params.hookData
            })
        );

        _unlockActive = true;
        // Trusted V4 PoolManager unlock callback: rebalancePosition is nonReentrant and _unlockActive gates
        // the callback, so the balance snapshots taken before unlock (used for the refund) and the _positions
        // state write performed after it cannot be corrupted by cross-function reentrancy.
        // slither-disable-next-line reentrancy-balance,reentrancy-no-eth
        bytes memory result = poolManager.unlock(
            abi.encode(Action.REBALANCE, abi.encode(position, params, balance0Before, balance1Before))
        );
        _unlockActive = false;
        (closedAmount0, closedAmount1, usedAmount0, usedAmount1) =
            abi.decode(result, (uint256, uint256, uint256, uint256));
        if (closedAmount0 < params.amount0Min || closedAmount1 < params.amount1Min) revert SlippageExceeded();
        // Enforce the same maxima as mintPosition: the re-mint must not consume more of
        // either token than the caller's stated caps (fresh funds pulled + closed proceeds).
        if (usedAmount0 > params.amount0Max || usedAmount1 > params.amount1Max) revert AmountMaximumExceeded();

        _positions[params.tokenId] =
            Position(position.poolKey, params.tickLower, params.tickUpper, params.liquidity, position.salt);
        _refund(position.poolKey, positionOwner, balance0Before, balance1Before);
    }

    function getPosition(uint256 tokenId) external view returns (Position memory) {
        return _positions[tokenId];
    }

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
            // modifyLiquidity's fees-accrued return is intentionally unused — delta settled via _settleOwed.
            // slither-disable-next-line unused-return
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
        if (action == Action.REBALANCE) {
            (
                Position memory oldPosition,
                RebalancePositionParams memory params,
                uint256 balance0Before,
                uint256 balance1Before
            ) = abi.decode(actionData, (Position, RebalancePositionParams, uint256, uint256));
            // modifyLiquidity's fees-accrued return is intentionally unused — closed principal taken below.
            // slither-disable-next-line unused-return
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

            // modifyLiquidity's fees-accrued return is intentionally unused — re-mint delta settled below.
            // slither-disable-next-line unused-return
            (BalanceDelta addDelta,) = poolManager.modifyLiquidity(
                oldPosition.poolKey,
                ModifyLiquidityParams(
                    params.tickLower, params.tickUpper, int256(uint256(params.liquidity)), oldPosition.salt
                ),
                params.hookData
            );
            (uint256 usedAmount0, uint256 usedAmount1) =
                _settleOwedCallScoped(oldPosition.poolKey, addDelta, balance0Before, balance1Before);
            return abi.encode(closedAmount0, closedAmount1, usedAmount0, usedAmount1);
        }
        (Position memory removePosition, uint128 liquidity, bytes memory hookData) =
            abi.decode(actionData, (Position, uint128, bytes));
        // modifyLiquidity's fees-accrued return is intentionally unused — removed principal is taken directly below.
        // slither-disable-next-line unused-return
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

    function _settleCallScoped(Currency currency, uint256 amount, uint256 balanceBefore) internal {
        if (amount == 0) return;
        uint256 balance = _balanceOf(currency);
        if (balance < balanceBefore || balance - balanceBefore < amount) revert InsufficientCallBalance();
        _settle(currency, amount);
    }

    function _settle(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        if (currency.isAddressZero()) {
            // settle()'s return (amount settled) is intentionally unused — the PoolManager enforces delta accounting.
            // slither-disable-next-line unused-return
            poolManager.settle{value: amount}();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
            // settle()'s return (amount settled) is intentionally unused — the PoolManager enforces delta accounting.
            // slither-disable-next-line unused-return
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

    function _refundCurrency(Currency currency, address recipient, uint256 balanceBefore) internal {
        uint256 balanceAfter = _balanceOf(currency);
        uint256 amount = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;
        // Strict-zero check on a computed refund amount is a deliberate no-op guard, not an exploitable equality.
        // slither-disable-next-line incorrect-equality
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

    function _payCurrency(Currency currency, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        if (currency.isAddressZero()) {
            // Safe: recipient is always the position's NFT owner (ownerOf) and only an owner/approved
            // operator can trigger a payout — native tokens never go to an arbitrary address.
            // slither-disable-next-line arbitrary-send-eth
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

    receive() external payable {}
}
