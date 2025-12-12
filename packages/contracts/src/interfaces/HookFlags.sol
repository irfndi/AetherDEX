// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

interface HookFlags {
    enum Flags {
        AFTER_MODIFY_POSITION,
        AFTER_SWAP,
        BEFORE_MODIFY_POSITION,
        BEFORE_SWAP
    }
}
