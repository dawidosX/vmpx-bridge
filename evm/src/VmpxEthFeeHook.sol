// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {AbstractPostDispatchHook} from "@hyperlane-xyz/core/contracts/hooks/libs/AbstractPostDispatchHook.sol";
import {IPostDispatchHook} from "@hyperlane-xyz/core/contracts/interfaces/hooks/IPostDispatchHook.sol";
import {StandardHookMetadata} from "@hyperlane-xyz/core/contracts/hooks/libs/StandardHookMetadata.sol";
import {Message} from "@hyperlane-xyz/core/contracts/libs/Message.sol";
import {TokenMessage} from "@hyperlane-xyz/core/contracts/token/libs/TokenMessage.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title VmpxEthFeeHook
 * @notice Post-dispatch hook that charges the project's bridge fee in native ETH
 *         for ETH -> X1 transfers of VMPX. Installed as the `hook` of
 *         VmpxCollateralRouter, so every `transferRemote` pays it — calling the
 *         router directly cannot bypass the fee.
 *
 * Fee formula (ETH wei):
 *     raw = amount * refPriceWeiPerToken / 1e18 * feeBps / 10_000
 *     fee = clamp(raw, minFeeWei, maxFeeWei)
 *     if the reference price is stale: fee = staleFallbackFeeWei
 *
 * Why a governance-set reference price instead of an on-chain TWAP:
 *   VMPX/WETH liquidity on Ethereum is ~5 kUSD with ~10 USD/day volume
 *   (checked 2026-10-28). Any on-chain spot/TWAP from such a pool is cheap
 *   to move. The reference price is therefore set by `priceUpdater`, with
 *   hard on-chain bounds: max relative change per update, min interval
 *   between updates, max age. Wrong prices can only move the fee between
 *   `minFeeWei` and `maxFeeWei`; they can never touch user collateral.
 *
 * Public limits (immutable): MAX_FEE_BPS, MAX_FEE_CAP_WEI, PARAM_DELAY,
 * MAX_PRICE_CHANGE_BPS (per update), MAX_DAILY_PRICE_CHANGE_BPS (per 24h).
 * Every fee parameter change / price reset is announced on-chain, executable
 * by the owner only after PARAM_DELAY and expires after EXECUTION_GRACE.
 *
 * Funds separation: this contract only ever holds project fee revenue.
 * It never holds user collateral. Failure to withdraw fees never affects the
 * bridge (the X1 -> ETH unlock path does not call this contract).
 */
contract VmpxEthFeeHook is AbstractPostDispatchHook, Ownable2Step {
    using StandardHookMetadata for bytes;
    using Message for bytes;
    using TokenMessage for bytes;
    using Address for address payable;

    // ------------------------------------------------------------ immutables
    address public immutable router;
    uint32 public immutable localDomain;
    uint32 public immutable destinationDomain;
    uint16 public immutable MAX_FEE_BPS; // public hard cap, e.g. 300 = 3%
    uint256 public immutable MAX_FEE_CAP_WEI; // max fee per transfer that can ever be configured
    uint256 public immutable PARAM_DELAY; // seconds between announce and execute
    uint16 public immutable MAX_PRICE_CHANGE_BPS; // per price update
    uint256 public immutable MIN_PRICE_UPDATE_INTERVAL;
    /// cumulative bound per FIXED 24h window: the anchor resets when the window expires, so changes just before and
    /// just after a window boundary are counted separately. Around a boundary the price can move by up to
    /// (1 + MAX_DAILY)^2 - 1 within a few hours (+125% with 50%; Codex L-01, review N-4). With the fixed fee
    /// (feeBps = 0, min = max) the reference price no longer affects the fee.
    uint16 public immutable MAX_DAILY_PRICE_CHANGE_BPS;
    uint256 public constant EXECUTION_GRACE = 7 days; // announced changes expire if not executed

    // ------------------------------------------------------------ fee params
    struct FeeParams {
        uint16 feeBps;
        uint256 minFeeWei;
        uint256 maxFeeWei;
        uint256 staleFallbackFeeWei;
        uint256 maxPriceAge;
    }

    FeeParams public params;
    FeeParams public pendingParams;
    uint256 public pendingParamsEta; // 0 = none

    // ------------------------------------------------------------ price
    uint256 public refPriceWeiPerToken; // wei per 1e18 token units
    uint256 public priceUpdatedAt;
    address public priceUpdater;
    uint256 public windowAnchorPrice; // price at start of the current 24h window
    uint256 public windowStart;

    // ------------------------------------------------------------ revenue
    address payable public beneficiary;
    uint256 public totalFeesCollected;

    // ------------------------------------------------------------ events
    event FeeCharged(bytes32 indexed messageId, address indexed payer, uint256 amount, uint256 feeWei, bool stale);
    event FeeParamsAnnounced(FeeParams params, uint256 eta);
    event FeeParamsExecuted(FeeParams params);
    event FeeParamsCancelled();
    event PriceUpdated(uint256 oldPrice, uint256 newPrice, uint256 at);
    event PriceUpdaterSet(address indexed updater);
    event BeneficiarySet(address indexed beneficiary);
    event FeesWithdrawn(address indexed beneficiary, uint256 amount);

    error WrongSender(address sender);
    error WrongOrigin(uint32 origin);
    error WrongDestination(uint32 destination);
    error InsufficientFee(uint256 required, uint256 provided);
    error InvalidParams();
    error NotReady();
    error NotPriceUpdater();
    error PriceChangeTooLarge(uint256 oldPrice, uint256 newPrice);
    error PriceUpdateTooSoon();
    error Expired();

    constructor(
        address _router,
        uint32 _localDomain,
        uint32 _destinationDomain,
        uint16 _maxFeeBps,
        uint256 _maxFeeCapWei,
        uint256 _paramDelay,
        uint16 _maxPriceChangeBps,
        uint16 _maxDailyPriceChangeBps,
        uint256 _minPriceUpdateInterval,
        FeeParams memory _initial,
        uint256 _initialPriceWeiPerToken,
        address _priceUpdater,
        address payable _beneficiary,
        address _owner
    ) {
        require(_router != address(0) && _beneficiary != address(0) && _priceUpdater != address(0), "zero addr");
        require(_maxFeeBps <= 1_000, "cap >10%");
        require(_maxPriceChangeBps > 0 && _maxPriceChangeBps <= 10_000, "bad change bound");
        require(_initialPriceWeiPerToken > 0, "price=0"); // with price 0 no relative update can ever pass (Codex L-02)
        router = _router;
        localDomain = _localDomain;
        destinationDomain = _destinationDomain;
        MAX_FEE_BPS = _maxFeeBps;
        MAX_FEE_CAP_WEI = _maxFeeCapWei;
        PARAM_DELAY = _paramDelay;
        MAX_PRICE_CHANGE_BPS = _maxPriceChangeBps;
        MIN_PRICE_UPDATE_INTERVAL = _minPriceUpdateInterval;
        require(_maxDailyPriceChangeBps >= _maxPriceChangeBps, "daily < step");
        MAX_DAILY_PRICE_CHANGE_BPS = _maxDailyPriceChangeBps;
        _validate(_initial);
        params = _initial;
        refPriceWeiPerToken = _initialPriceWeiPerToken;
        priceUpdatedAt = block.timestamp;
        windowAnchorPrice = _initialPriceWeiPerToken;
        windowStart = block.timestamp;
        priceUpdater = _priceUpdater;
        beneficiary = _beneficiary;
        _transferOwnership(_owner);
    }

    // =============================================================== hook

    function hookType() external pure override returns (uint8) {
        return uint8(IPostDispatchHook.HookTypes.PROTOCOL_FEE);
    }

    /// @dev only native-token fee metadata is accepted
    function supportsMetadata(bytes calldata metadata) public pure override returns (bool) {
        if (metadata.length == 0) return true;
        if (metadata.variant() != StandardHookMetadata.VARIANT) return false;
        return metadata.feeToken(address(0)) == address(0);
    }

    function _quoteDispatch(bytes calldata, bytes calldata message) internal view override returns (uint256) {
        _checkMessage(message);
        (uint256 fee, ) = feeFor(message.body().amount());
        return fee;
    }

    function _postDispatch(bytes calldata metadata, bytes calldata message) internal override {
        _checkMessage(message);
        uint256 amount = message.body().amount();
        (uint256 fee, bool stale) = feeFor(amount);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);
        totalFeesCollected += fee;
        emit FeeCharged(message.id(), metadata.refundAddress(message.senderAddress()), amount, fee, stale);
        _refund(metadata, message, msg.value - fee);
    }

    function _checkMessage(bytes calldata message) internal view {
        if (message.senderAddress() != router) revert WrongSender(message.senderAddress());
        if (message.origin() != localDomain) revert WrongOrigin(message.origin());
        if (message.destination() != destinationDomain) revert WrongDestination(message.destination());
    }

    // =============================================================== quoting

    /// @notice fee in wei for `amount` (18-dec VMPX units) and whether the stale fallback applied
    function feeFor(uint256 amount) public view returns (uint256 fee, bool stale) {
        FeeParams memory p = params;
        stale = block.timestamp > priceUpdatedAt + p.maxPriceAge;
        if (stale) return (p.staleFallbackFeeWei, true);
        // single division (no precision loss): amount <= 1.09e26, price*bps bounded -> no overflow in practice
        uint256 raw = (amount * refPriceWeiPerToken * p.feeBps) / (1e18 * 10_000);
        if (raw < p.minFeeWei) raw = p.minFeeWei;
        if (raw > p.maxFeeWei) raw = p.maxFeeWei;
        return (raw, false);
    }

    // =============================================================== governance

    function announceParams(FeeParams calldata p) external onlyOwner {
        _validate(p);
        pendingParams = p;
        pendingParamsEta = block.timestamp + PARAM_DELAY;
        emit FeeParamsAnnounced(p, pendingParamsEta);
    }

    function executeParams() external onlyOwner {
        if (pendingParamsEta == 0 || block.timestamp < pendingParamsEta) revert NotReady();
        if (block.timestamp > pendingParamsEta + EXECUTION_GRACE) revert Expired();
        params = pendingParams;
        delete pendingParams;
        pendingParamsEta = 0;
        emit FeeParamsExecuted(params);
    }

    function cancelParams() external onlyOwner {
        delete pendingParams;
        pendingParamsEta = 0;
        emit FeeParamsCancelled();
    }

    function _validate(FeeParams memory p) internal view {
        if (p.feeBps > MAX_FEE_BPS) revert InvalidParams();
        if (p.maxFeeWei > MAX_FEE_CAP_WEI) revert InvalidParams();
        if (p.minFeeWei > p.maxFeeWei) revert InvalidParams();
        if (p.staleFallbackFeeWei > p.maxFeeWei) revert InvalidParams();
        if (p.maxPriceAge == 0) revert InvalidParams();
    }

    function setPriceUpdater(address u) external onlyOwner {
        require(u != address(0), "zero");
        priceUpdater = u;
        emit PriceUpdaterSet(u);
    }

    /// @notice bounded reference-price update (wei per 1 whole VMPX)
    function updatePrice(uint256 newPrice) external {
        if (msg.sender != priceUpdater) revert NotPriceUpdater();
        if (block.timestamp < priceUpdatedAt + MIN_PRICE_UPDATE_INTERVAL) revert PriceUpdateTooSoon();
        uint256 old = refPriceWeiPerToken;
        require(newPrice > 0, "price=0");
        uint256 diff = newPrice > old ? newPrice - old : old - newPrice;
        if (diff * 10_000 > old * MAX_PRICE_CHANGE_BPS) revert PriceChangeTooLarge(old, newPrice);
        if (block.timestamp >= windowStart + 1 days) {
            windowStart = block.timestamp;
            windowAnchorPrice = old;
        }
        uint256 a = windowAnchorPrice;
        uint256 cum = newPrice > a ? newPrice - a : a - newPrice;
        if (cum * 10_000 > a * MAX_DAILY_PRICE_CHANGE_BPS) revert PriceChangeTooLarge(a, newPrice);
        refPriceWeiPerToken = newPrice;
        priceUpdatedAt = block.timestamp;
        emit PriceUpdated(old, newPrice, block.timestamp);
    }

    // Large price re-basing (e.g. after a long outage) bypasses the per-update
    // bound but goes through the same public PARAM_DELAY.
    uint256 public pendingPriceReset;
    uint256 public pendingPriceResetEta;
    event PriceResetAnnounced(uint256 price, uint256 eta);

    function announcePriceReset(uint256 price) external onlyOwner {
        require(price > 0, "price=0");
        pendingPriceReset = price;
        pendingPriceResetEta = block.timestamp + PARAM_DELAY;
        emit PriceResetAnnounced(price, pendingPriceResetEta);
    }

    function cancelPriceReset() external onlyOwner {
        pendingPriceReset = 0;
        pendingPriceResetEta = 0;
        emit FeeParamsCancelled();
    }

    function executePriceReset() external onlyOwner {
        if (pendingPriceResetEta == 0 || block.timestamp < pendingPriceResetEta) revert NotReady();
        if (block.timestamp > pendingPriceResetEta + EXECUTION_GRACE) revert Expired();
        uint256 old = refPriceWeiPerToken;
        refPriceWeiPerToken = pendingPriceReset;
        priceUpdatedAt = block.timestamp;
        windowAnchorPrice = pendingPriceReset;
        windowStart = block.timestamp;
        pendingPriceReset = 0;
        pendingPriceResetEta = 0;
        emit PriceUpdated(old, refPriceWeiPerToken, block.timestamp);
    }

    function setBeneficiary(address payable b) external onlyOwner {
        require(b != address(0), "zero");
        beneficiary = b;
        emit BeneficiarySet(b);
    }

    /// @notice permissionless; funds can only go to `beneficiary`
    function withdrawFees() external {
        uint256 bal = address(this).balance;
        emit FeesWithdrawn(beneficiary, bal);
        beneficiary.sendValue(bal);
    }
}
