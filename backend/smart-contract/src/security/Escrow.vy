#/* SPDX-License-Identifier: GPL-3.0 */

#/*
# Created by irfndi (github.com/irfndi) - Apr 2025
# Email: join.mantap@gmail.com
# */

@version 0.3.10

interface ERC20:
    def transfer(recipient: address, amount: uint256) -> bool: nonpayable
    def transferFrom(sender: address, recipient: address, amount: uint256) -> bool: nonpayable
    def balanceOf(account: address) -> uint256:
        view

# State variables
buyer: public(address)
seller: public(address)
arbiter: public(address)
token: public(ERC20)
amount: public(uint256)
isFunded: public(bool)
isReleased: public(bool)

# Events

event Funded:
    sender: indexed(address)
    amount: uint256

event Released:
    amount: uint256

event Refunded:
    amount: uint256

event DisputeResolved:
    recipient: indexed(address)
    amount: uint256

@external
@external
def __init__(_buyer: address, _seller: address, _arbiter: address, _token: ERC20, _amount: uint256):
    """
    @param _buyer The address that funds the escrow
    @param _seller The address that receives funds upon release
    @param _arbiter The address that can release or refund
    @param _token The ERC20 token address
    @param _amount The amount to hold in escrow
    """
    assert _buyer != empty(address), "Buyer cannot be zero address"
    assert _seller != empty(address), "Seller cannot be zero address"
    assert _arbiter != empty(address), "Arbiter cannot be zero address"
    assert _token.address != empty(address), "Token cannot be zero address"
    assert _amount > 0, "Amount must be greater than zero"

    # Prevent conflict of interest
    assert _buyer != _seller, "Buyer cannot be seller"
    assert _buyer != _arbiter, "Buyer cannot be arbiter"
    assert _seller != _arbiter, "Seller cannot be arbiter"

    self.buyer = _buyer
    assert msg.sender == self.buyer, "Only buyer can fund"
    assert not self.isFunded, "Already funded"
    self.isFunded = True  # effects
    res: bool = self.token.transferFrom(msg.sender, self, self.amount)  # interaction
    assert res, "Transfer failed"
    log Funded(msg.sender, self.amount)

@external
def fund():
    """
    @notice Deposit funds into escrow
    """
    assert msg.sender == self.buyer, "Only buyer can fund"
    assert not self.isFunded, "Already funded"
    res: bool = self.token.transferFrom(msg.sender, self, self.amount)
    assert res, "Transfer failed"
    self.isFunded = True
    log Funded(msg.sender, self.amount)

@external
def release():
    """
    @notice Release funds to the seller
    """
    assert msg.sender == self.arbiter, "Only arbiter can release funds" #dev: check caller is arbiter
    assert self.isFunded, "Not funded"
    assert not self.isReleased, "Already released"
    res: bool = self.token.transfer(self.seller, self.amount)
    assert not self.isReleased, "Already released"
    self.isReleased = True  # Update state before external call
    res: bool = self.token.transfer(self.buyer, self.amount)
    assert res, "Transfer failed"
    log Refunded(self.amount)
@external
def refund():
    """
    @notice Refund funds to the buyer
    """
    assert msg.sender == self.arbiter, "Only arbiter can refund funds" #dev: check caller is arbiter
    assert self.isFunded, "Not funded"
    assert not self.isReleased, "Already released"
    res: bool = self.token.transfer(self.buyer, self.amount)
    assert res, "Transfer failed"
    self.isReleased = True
    log Refunded(self.amount)

@external
def resolve_dispute(recipient: address):
    """
    @notice Arbiter resolves a dispute and sends funds to the specified recipient (buyer or seller).
    @param recipient The address (either buyer or seller) to receive the funds.
    """
    assert msg.sender == self.arbiter, "Only arbiter can resolve dispute"
    assert self.isFunded, "Not funded"
    assert not self.isReleased, "Funds already released/refunded"
    assert recipient == self.buyer or recipient == self.seller, "Recipient must be buyer or seller"

    res: bool = self.token.transfer(recipient, self.amount)
    assert res, "Transfer failed"
    
    self.isReleased = True # Mark as handled
    log DisputeResolved(recipient, self.amount)
