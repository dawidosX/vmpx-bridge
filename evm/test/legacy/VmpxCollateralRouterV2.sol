// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {HypERC20Collateral} from "@hyperlane-xyz/core/contracts/token/HypERC20Collateral.sol";
import {ITokenBridge} from "@hyperlane-xyz/core/contracts/interfaces/ITokenBridge.sol";
import {TokenMessage} from "@hyperlane-xyz/core/contracts/token/libs/TokenMessage.sol";

/**
 * @title VmpxCollateralRouterV2 (frozen copy of the deployed v2, used only by upgrade tests)
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
 *     the lockbox single-purpose: user collateral only. Upstream `donate()`
 *     (public payable) cannot be disabled here: neither it nor
 *     `HypERC20Collateral._transferFromSender` is virtual (Codex I-01). A
 *     donation, like a plain ERC-20 transfer, only adds surplus that nobody
 *     can claim; monitoring treats lockbox >= liabilities as solvent and
 *     reports the surplus separately. ETH sent with donate() stays in the
 *     router (no recovery path) - do not call it.
 *  3. Collateral rebalancing disabled: upstream lets the owner whitelist
 *     bridges + rebalancers that can move collateral out. A lockbox for a
 *     single synthetic route has no legitimate need for that; we remove the
 *     capability so a compromised owner cannot use it as a drain path.
 *  4. Implementation initializers disabled (deployed behind a proxy).
 *  5. Token-denominated fee paths disabled: `feeRecipient()` always returns 0
 *     (so `setFeeRecipient` has no effect) and transfers revert if a token
 *     `feeHook` is ever set. Upstream would otherwise let the owner pull an
 *     arbitrary extra amount of eVMPX from users with a standing allowance.
 *     The relayer-gas fee is charged in ETH by VmpxEthFeeHook.
 *  6. Bridge fee in eVMPX (v2), DEDUCTED from the amount, never added on top:
 *     the sender is pulled exactly `_amount` (what they typed and approved);
 *     `fee = floor(_amount * feeBps / 10_000)` rounded down to `dustUnit` goes
 *     to `treasury`; the message (and the lockbox) carry `_amount - fee`, so
 *     lockbox balance == X1 supply stays exact. `feeBps <= MAX_FEE_BPS`
 *     (immutable, 5%); `feeBps` and `treasury` change only through the owner
 *     (the TimelockController). Storage lives in an ERC-7201 namespace so the
 *     upgrade from v1 cannot collide with upstream storage.
 *
 * Everything else (message format, ISM handling, replay protection via the
 * Mailbox, router enrollment checks) is unchanged upstream code.
 */
contract VmpxCollateralRouterV2 is HypERC20Collateral {
    /// @notice smallest transferable unit in 18-dec local units (= 1 unit at 9 decimals on X1)
    uint256 public immutable dustUnit;

    error AmountNotMultipleOfDustUnit(uint256 amount, uint256 dustUnit);
    error ZeroAmount();
    error Disabled();
    error TokenFeeHookNotAllowed();
    error FeeAboveMax(uint256 feeBps, uint256 maxFeeBps);
    error InvalidTreasury();
    error FeeNotBelowAmount(uint256 fee, uint256 amount);

    /// @notice hard cap of the eVMPX bridge fee, in basis points (500 = 5%)
    uint256 public constant MAX_FEE_BPS = 500;

    /// @custom:storage-location erc7201:vmpx.storage.BridgeFee
    struct BridgeFeeStorage {
        address treasury;
        uint16 feeBps;
    }

    // keccak256(abi.encode(uint256(keccak256("vmpx.storage.BridgeFee")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant BRIDGE_FEE_SLOT = 0x877831e9fe6d41f86d33867c018b5318e4ea9ec1d3b41eca5fcc1a1a6c78a400;

    event BridgeFeeSet(uint256 feeBps, address treasury);
    /// @notice `gross` = pulled from `payer`; `fee` went to the treasury; `gross - fee` was locked and sent to X1
    event BridgeFeeTaken(bytes32 indexed messageId, address indexed payer, uint256 gross, uint256 fee);

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

        BridgeFeeStorage storage $ = _bridgeFeeStorage();
        uint256 fee = _bridgeFee(_amount, $.feeBps);
        if (fee >= _amount) revert FeeNotBelowAmount(fee, _amount); // unreachable while MAX_FEE_BPS < 10_000

        // same flow as TokenRouter._transferRemote with feeRecipient = 0, no token fee hook
        // and no external fee: pull exactly _amount, then split it
        _transferFromSender(_amount);
        if (fee > 0) _transferTo($.treasury, fee);

        uint256 scaled = _outboundAmount(_amount - fee);
        bytes32 messageId = _emitAndDispatch(_destination, _recipient, scaled, msg.value, TokenMessage.format(_recipient, scaled));
        if (fee > 0) emit BridgeFeeTaken(messageId, msg.sender, _amount, fee);
        return messageId;
    }

    // ------------------------------------------------------- bridge fee (v2)

    /// @notice fee and net amount for a transfer of `amount` (18-dec units) at the current rate
    function quoteBridgeFee(uint256 amount) external view returns (uint256 fee, uint256 net) {
        fee = _bridgeFee(amount, _bridgeFeeStorage().feeBps);
        net = amount - fee;
    }

    function bridgeFeeBps() external view returns (uint256) {
        return _bridgeFeeStorage().feeBps;
    }

    function treasury() external view returns (address) {
        return _bridgeFeeStorage().treasury;
    }

    /// @notice owner = TimelockController, so every change waits the public timelock delay
    function setBridgeFee(uint256 _feeBps, address _treasury) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeAboveMax(_feeBps, MAX_FEE_BPS);
        if (_treasury == address(this) || (_feeBps > 0 && _treasury == address(0))) revert InvalidTreasury();
        BridgeFeeStorage storage $ = _bridgeFeeStorage();
        $.feeBps = uint16(_feeBps);
        $.treasury = _treasury;
        emit BridgeFeeSet(_feeBps, _treasury);
    }

    /// @dev rounded DOWN to dustUnit, so both fee and amount - fee stay representable on X1 (9 decimals)
    function _bridgeFee(uint256 amount, uint256 bps) internal view returns (uint256) {
        uint256 raw = (amount * bps) / 10_000;
        return raw - (raw % dustUnit);
    }

    function _bridgeFeeStorage() private pure returns (BridgeFeeStorage storage $) {
        assembly {
            $.slot := BRIDGE_FEE_SLOT
        }
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
