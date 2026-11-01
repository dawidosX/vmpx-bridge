// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {HypERC20Collateral} from "@hyperlane-xyz/core/contracts/token/HypERC20Collateral.sol";
import {ITokenBridge} from "@hyperlane-xyz/core/contracts/interfaces/ITokenBridge.sol";

/**
 * @title VmpxCollateralRouterV1 (frozen copy of the deployed v1, used only by upgrade tests)
 * @notice Lockbox for the ORIGINAL eVMPX (0xb48E...0b9C) on Ethereum, built on
 *         Hyperlane `HypERC20Collateral` from hyperlane-xyz core npm 12.2.0.
 *
 * Deliberate, minimal restrictions on top of the upstream contract
 * (these are OUT OF AUDIT SCOPE of upstream audits — see docs/05-audit-matrix.md):
 *
 *  1. Dust guard: the X1 representation uses 9 decimals, eVMPX uses 18.
 *     Upstream would silently strand the sub-1e-9 remainder in the lockbox.
 *     We revert instead, so a user can never lose value silently.
 *  2. LP vault disabled: upstream 12.x makes the collateral router an ERC-4626
 *     vault (LP deposits share the same balance as user collateral). We keep
 *     the lockbox single-purpose: user collateral only.
 *  3. Collateral rebalancing disabled: upstream lets the owner whitelist
 *     bridges + rebalancers that can move collateral out. A lockbox for a
 *     single synthetic route has no legitimate need for that; we remove the
 *     capability so a compromised owner cannot use it as a drain path.
 *  4. Implementation initializers disabled (deployed behind a proxy).
 *  5. Token-denominated fee paths disabled: `feeRecipient()` always returns 0
 *     (so `setFeeRecipient` has no effect) and transfers revert if a token
 *     `feeHook` is ever set. Upstream would otherwise let the owner pull an
 *     arbitrary extra amount of eVMPX from users with a standing allowance.
 *     The project fee is charged in ETH by VmpxEthFeeHook only.
 *
 * Everything else (message format, ISM handling, replay protection via the
 * Mailbox, router enrollment checks) is unchanged upstream code.
 */
contract VmpxCollateralRouterV1 is HypERC20Collateral {
    /// @notice smallest transferable unit in 18-dec local units (= 1 unit at 9 decimals on X1)
    uint256 public immutable dustUnit;

    error AmountNotMultipleOfDustUnit(uint256 amount, uint256 dustUnit);
    error ZeroAmount();
    error Disabled();
    error TokenFeeHookNotAllowed();

    constructor(
        address _erc20,
        address _mailbox,
        uint256 _dustUnit
    ) HypERC20Collateral(_erc20, 1, 1, _mailbox) {
        require(_dustUnit > 0, "dustUnit=0");
        dustUnit = _dustUnit;
        // deployed behind a TransparentUpgradeableProxy: lock the bare implementation
        _disableInitializers();
    }

    // ---------------------------------------------------------------- transfers

    function _transferRemote(
        uint32 _destination,
        bytes32 _recipient,
        uint256 _amount
    ) internal override returns (bytes32) {
        if (_amount == 0) revert ZeroAmount();
        if (_amount % dustUnit != 0)
            revert AmountNotMultipleOfDustUnit(_amount, dustUnit);
        require(_recipient != bytes32(0), "recipient=0");
        if (feeHook() != address(0)) revert TokenFeeHookNotAllowed();
        return super._transferRemote(_destination, _recipient, _amount);
    }

    // ---------------------------------------- disabled: token-denominated fees

    function feeRecipient() public pure override returns (address) {
        return address(0);
    }

    // ------------------------------------------------- disabled: ERC-4626 LP vault

    function deposit(uint256, address) public pure override returns (uint256) {
        revert Disabled();
    }

    function mint(uint256, address) public pure override returns (uint256) {
        revert Disabled();
    }

    function maxDeposit(address) public pure override returns (uint256) {
        return 0;
    }

    function maxMint(address) public pure override returns (uint256) {
        return 0;
    }

    // ------------------------------------------- disabled: collateral rebalancing

    function addBridge(uint32, ITokenBridge) external pure override {
        revert Disabled();
    }

    function setRecipient(uint32, bytes32) external pure override {
        revert Disabled();
    }
}
