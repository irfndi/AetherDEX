// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

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
        REMOVE
    }

    IPoolManager public immutable poolManager;
    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => Position position) private _positions;
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

    function _settle(Currency currency, uint256 amount) internal {
        poolManager.sync(currency);
        if (currency.isAddressZero()) {
            poolManager.settle{value: amount}();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
    }

    function _pullMaximums(MintPositionParams calldata params) internal {
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
