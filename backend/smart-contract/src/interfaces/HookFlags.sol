// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

interface HookFlags {
    enum Flags {
        AFTER_MODIFY_POSITION,
        AFTER_SWAP,
        BEFORE_MODIFY_POSITION,
        BEFORE_SWAP
    }
}
