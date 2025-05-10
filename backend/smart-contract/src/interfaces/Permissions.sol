// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

struct Permissions {
    bool beforeInitialize;
    bool afterInitialize;
    bool beforeModifyPosition;
    bool afterModifyPosition;
    bool beforeSwap;
    bool afterSwap;
    bool beforeDonate;
    bool afterDonate;
}
