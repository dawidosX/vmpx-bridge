// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {HypERC20Collateral} from "@hyperlane-xyz/core/contracts/token/HypERC20Collateral.sol";
import {ITokenBridge} from "@hyperlane-xyz/core/contracts/interfaces/ITokenBridge.sol";
import {TokenMessage} from "@hyperlane-xyz/core/contracts/token/libs/TokenMessage.sol";

/**
 * @title VmpxCollateralRouter
 * @notice Lockbox for the ORIGINAL VMPX (0xb48E...0b9C) on Ethereum, built on
 *         Hyperlane `HypERC20Collateral` from hyperlane-xyz core npm 12.2.0.
 *
 * Deliberate, minimal restrictions on top of the upstream contract
 * (these are OUT OF AUDIT SCOPE of upstream audits — see docs/05-audit-matrix.md):
 *
 *  1. Dust guard: the X1 representation uses 9 decimals, VMPX uses 18.
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
 *     arbitrary extra amount of VMPX from users with a standing allowance.
 *     The relayer-gas fee is charged in ETH by VmpxEthFeeHook.
 *  6. Bridge fee in VMPX (v2), DEDUCTED from the amount, never added on top:
 *     the sender is pulled exactly `_amount` (what they typed and approved);
 *     `fee = floor(_amount * feeBps / 10_000)` rounded down to `dustUnit` goes
 *     to `treasury`; the message (and the lockbox) carry `_amount - fee`, so
 *     lockbox balance == X1 supply stays exact. `feeBps <= MAX_FEE_BPS`
 *     (immutable, 5%); `feeBps` and `treasury` change only through the owner
 *     (the TimelockController). Storage lives in an ERC-7201 namespace so the
 *     upgrade from v1 cannot collide with upstream storage.
 *  7. TVL cap (v3): a deposit reverts if the lockbox balance after it
 *     (`balanceOf(this) + (_amount - fee)`, i.e. only what stays LOCKED; the fee
 *     goes to `treasury` in the same call and is never held here) would exceed
 *     `maxLocked`. Unlocks (X1 -> ETH) never check the cap. `maxLocked` is set
 *     by `initializeV3` (in the same Timelock batch as the upgrade) and changed
 *     by the owner (TimelockController) via `setMaxLocked`. `maxLocked == 0`
 *     (e.g. an upgrade without `initializeV3`) means deposits are CLOSED (fail
 *     closed); "no cap" must be set explicitly as `type(uint256).max`. Measured
 *     with balanceOf, so donations count against the cap (docs/14 §3a).
 *
 * Everything else (message format, ISM handling, replay protection via the
 * Mailbox, router enrollment checks) is unchanged upstream code.
 */
contract VmpxCollateralRouter is HypERC20Collateral {
    /// @notice smallest transferable unit in 18-dec local units (= 1 unit at 9 decimals on X1)
    uint256 public immutable dustUnit;

    error AmountNotMultipleOfDustUnit(uint256 amount, uint256 dustUnit);
    error ZeroAmount();
    error Disabled();
    error TokenFeeHookNotAllowed();
    error FeeAboveMax(uint256 feeBps, uint256 maxFeeBps);
    error InvalidTreasury();
    error FeeNotBelowAmount(uint256 fee, uint256 amount);
    error MaxLockedExceeded(uint256 lockedAfter, uint256 maxLocked);

    /// @notice hard cap of the VMPX bridge fee, in basis points (500 = 5%)
    uint256 public constant MAX_FEE_BPS = 500;

    /// @custom:storage-location erc7201:vmpx.storage.BridgeFee
    struct BridgeFeeStorage {
        address treasury;
        uint16 feeBps;
        // v3: appended (namespace slot + 1); 0 after an upgrade from v2 = deposits closed until set
        uint256 maxLocked;
    }

    // keccak256(abi.encode(uint256(keccak256("vmpx.storage.BridgeFee")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant BRIDGE_FEE_SLOT = 0x877831e9fe6d41f86d33867c018b5318e4ea9ec1d3b41eca5fcc1a1a6c78a400;

    event BridgeFeeSet(uint256 feeBps, address treasury);
    /// @notice `gross` = pulled from `payer`; `fee` went to the treasury; `gross - fee` was locked and sent to X1
    event BridgeFeeTaken(bytes32 indexed messageId, address indexed payer, uint256 gross, uint256 fee);
    event MaxLockedSet(uint256 oldMaxLocked, uint256 newMaxLocked);

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

        // TVL cap (v3): only the net part stays locked; the fee leaves for the treasury below
        uint256 lockedAfter = wrappedToken.balanceOf(address(this)) + (_amount - fee);
        if (lockedAfter > $.maxLocked) revert MaxLockedExceeded(lockedAfter, $.maxLocked);

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

    // ------------------------------------------------------------ TVL cap (v3)

    /// @notice upgrade v2 -> v3 (and fresh deploys): sets the cap once. onlyOwner, so it must run in the same
    ///         Timelock batch as `ProxyAdmin.upgrade` (ProxyAdmin.upgradeAndCall would call it as the ProxyAdmin).
    function initializeV3(uint256 _maxLocked) external onlyOwner reinitializer(3) {
        _setMaxLocked(_maxLocked);
    }

    /// @notice owner = TimelockController. Lowering below the current balance only blocks new deposits.
    function setMaxLocked(uint256 _maxLocked) external onlyOwner {
        _setMaxLocked(_maxLocked);
    }

    /// @notice cap on VMPX held by the lockbox (18-dec); 0 = deposits closed, type(uint256).max = no cap
    function maxLocked() external view returns (uint256) {
        return _bridgeFeeStorage().maxLocked;
    }

    function _setMaxLocked(uint256 _maxLocked) internal {
        BridgeFeeStorage storage $ = _bridgeFeeStorage();
        emit MaxLockedSet($.maxLocked, _maxLocked);
        $.maxLocked = _maxLocked;
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
