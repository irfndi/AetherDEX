// SPDX-License-Identifier: GPL-3.0
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
