// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";

import {MockMailbox} from "@hyperlane-xyz/core/contracts/mock/MockMailbox.sol";
import {HypERC20} from "@hyperlane-xyz/core/contracts/token/HypERC20.sol";
import {StaticMessageIdMultisigIsmFactory} from "@hyperlane-xyz/core/contracts/isms/multisig/StaticMultisigIsm.sol";
import {StaticAggregationIsmFactory} from "@hyperlane-xyz/core/contracts/isms/aggregation/StaticAggregationIsmFactory.sol";
import {PausableIsm} from "@hyperlane-xyz/core/contracts/isms/PausableIsm.sol";
import {RateLimitedIsm} from "@hyperlane-xyz/core/contracts/isms/warp-route/RateLimitedIsm.sol";
import {CheckpointLib} from "@hyperlane-xyz/core/contracts/libs/CheckpointLib.sol";
import {TypeCasts} from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";
import {Quote} from "@hyperlane-xyz/core/contracts/interfaces/ITokenBridge.sol";

import {VmpxCollateralRouter} from "../src/VmpxCollateralRouter.sol";
import {MerkleTreeHook} from "@hyperlane-xyz/core/contracts/hooks/MerkleTreeHook.sol";
import {PausableHook} from "@hyperlane-xyz/core/contracts/hooks/PausableHook.sol";
import {StaticAggregationHookFactory} from "@hyperlane-xyz/core/contracts/hooks/aggregation/StaticAggregationHookFactory.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {VmpxEthFeeHook} from "../src/VmpxEthFeeHook.sol";

/// @dev Behavioural replica of VMPX (OZ ERC20Capped, 18 dec, cap 108,624,000, no fees/hooks).
contract MockVMPX is ERC20Capped {
    constructor() ERC20("VMPX", "VMPX") ERC20Capped(108_624_000 ether) {}

    function mintTo(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/**
 * Two MockMailboxes: domain 1 (Ethereum) and X1_DOMAIN.
 * The X1 side uses Hyperlane's EVM HypERC20 with 9 decimals as a STAND-IN for the
 * Sealevel synthetic token program. It reproduces the same arithmetic
 * (remote 18 dec -> local 9 dec, truncating) but is NOT the SVM program.
 * Real SVM behaviour must be confirmed by svm/ compatibility tests on X1 testnet.
 */
abstract contract BridgeBase is Test {
    using TypeCasts for address;

    uint32 internal constant ETH = 1;
    uint32 internal constant X1_DOMAIN = 1_479_626_324; // "X1NT"; unused in hyperlane-registry @05582adc (2026-10-28)
    uint256 internal constant DUST = 1e9;
    bytes32 internal constant FAKE_MERKLE_HOOK = bytes32(uint256(0xBEEF));

    MockMailbox internal ethMb;
    MockMailbox internal x1Mb;
    MockVMPX internal vmpx;
    VmpxCollateralRouter internal lockbox;
    HypERC20 internal synth;
    VmpxEthFeeHook internal feeHook;
    PausableIsm internal pauseIsm; // inbound (unlock) pause — guardian
    PausableHook internal pauseHook; // outbound (deposit) pause — guardian
    MerkleTreeHook internal ethMerkle;
    ProxyAdmin internal proxyAdmin; // owned by timelock
    TimelockController internal timelock;
    VmpxCollateralRouter internal lockboxImpl;
    address internal guardian = address(0x6A2D);
    uint256 internal constant TIMELOCK_DELAY = 48 hours;
    RateLimitedIsm internal rateIsm;
    address internal ethIsm; // aggregation(multisig, pausable, rateLimited) on ETH
    address internal x1Ism; // multisig on X1

    // validators that attest X1-origin messages (verified on ETH)
    uint256[] internal x1ValKeys;
    // validators that attest ETH-origin messages (verified on X1)
    uint256[] internal ethValKeys;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address payable internal treasury = payable(address(0x7EA5));
    address internal priceBot = address(0xB07);

    uint256 internal constant RATE_CAP = 1_036_800 ether; // = 86400 * 12 VMPX: exact multiple of 1 day (no truncation)
    uint256 internal constant PRICE = 4e11; // wei per VMPX (~0.0000004 ETH) — illustrative

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        ethMb = new MockMailbox(ETH);
        x1Mb = new MockMailbox(X1_DOMAIN);
        ethMb.addRemoteMailbox(X1_DOMAIN, x1Mb);
        x1Mb.addRemoteMailbox(ETH, ethMb);

        vmpx = new MockVMPX();

        // ---- validator sets (2-of-3 each) ----
        for (uint256 i = 1; i <= 3; i++) {
            x1ValKeys.push(0x1000 + i);
            ethValKeys.push(0x2000 + i);
        }
        StaticMessageIdMultisigIsmFactory msf = new StaticMessageIdMultisigIsmFactory();
        address msigOnEth = msf.deploy(_addrs(x1ValKeys), 2);
        x1Ism = msf.deploy(_addrs(ethValKeys), 2);

        // ---- governance: timelock (admin, slow) + guardian (pause, fast) ----
        address[] memory ps = new address[](1);
        ps[0] = address(this); // stands in for the admin Safe
        timelock = new TimelockController(TIMELOCK_DELAY, ps, ps, address(0));
        proxyAdmin = new ProxyAdmin();
        proxyAdmin.transferOwnership(address(timelock));

        // ---- ETH lockbox behind a transparent proxy (upgradeable only via timelock) ----
        lockboxImpl = new VmpxCollateralRouter(address(vmpx), address(ethMb), DUST);
        lockbox = VmpxCollateralRouter(
            address(
                new TransparentUpgradeableProxy(
                    address(lockboxImpl),
                    address(proxyAdmin),
                    abi.encodeCall(lockboxImpl.initialize, (address(0), address(0), address(this)))
                )
            )
        );

        pauseIsm = new PausableIsm(guardian);
        rateIsm = new RateLimitedIsm(address(ethMb), RATE_CAP, 1 days, address(lockbox));
        address[] memory mods = new address[](3);
        mods[0] = msigOnEth;
        mods[1] = address(pauseIsm);
        mods[2] = address(rateIsm);
        ethIsm = new StaticAggregationIsmFactory().deploy(mods, 3);

        lockbox.setInterchainSecurityModule(ethIsm);
        // TVL cap (v3): explicit "no cap" here; cap behaviour lives in MaxLocked.t.sol. setMaxLocked (not initializeV3)
        // keeps the proxy at initializer version 1, so upgrade tests can still run the real initializeV3 step.
        lockbox.setMaxLocked(type(uint256).max);

        feeHook = new VmpxEthFeeHook(
            address(lockbox),
            ETH,
            X1_DOMAIN,
            300, // MAX_FEE_BPS = 3% public hard cap
            0.05 ether, // MAX_FEE_CAP_WEI
            3 days, // PARAM_DELAY
            2_000, // max 20% price move per update
            5_000, // max 50% cumulative per 24h
            1 hours, // min interval between price updates
            VmpxEthFeeHook.FeeParams({
                feeBps: 300,
                minFeeWei: 0.0002 ether,
                maxFeeWei: 0.02 ether,
                staleFallbackFeeWei: 0.001 ether,
                maxPriceAge: 2 days
            }),
            PRICE,
            priceBot,
            treasury,
            address(this)
        );
        pauseHook = new PausableHook();
        pauseHook.transferOwnership(guardian);
        ethMerkle = new MerkleTreeHook(address(ethMb));
        // ORDER MATTERS: the router's own hook replaces the mailbox default hook, so the
        // merkle tree hook MUST be in this list or validators can never attest deposits.
        address[] memory hooks = new address[](3);
        hooks[0] = address(pauseHook);
        hooks[1] = address(ethMerkle);
        hooks[2] = address(feeHook);
        lockbox.setHook(new StaticAggregationHookFactory().deploy(hooks));

        // ---- X1 synthetic stand-in: 9 decimals, message carries 18-dec amounts ----
        synth = new HypERC20(9, 1e9, 1, address(x1Mb));
        synth.initialize(0, "VMPX (bridged from Ethereum, unofficial)", "VMPX.e", address(0), x1Ism, address(this));

        lockbox.enrollRemoteRouter(X1_DOMAIN, address(synth).addressToBytes32());
        synth.enrollRemoteRouter(ETH, address(lockbox).addressToBytes32());

        vmpx.mintTo(alice, 1_000_000 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ------------------------------------------------------------------ helpers

    function _addrs(uint256[] memory keys) internal pure returns (address[] memory a) {
        a = new address[](keys.length);
        for (uint256 i; i < keys.length; i++) a[i] = vm.addr(keys[i]);
    }

    function _signMsgId(bytes memory message, uint256[] memory signers) internal pure returns (bytes memory meta) {
        uint32 origin = uint32(bytes4(_slice(message, 5, 4)));
        bytes32 root = keccak256("root");
        uint32 index = 7;
        bytes32 digest = CheckpointLib.digest(origin, FAKE_MERKLE_HOOK, root, index, keccak256(message));
        meta = abi.encodePacked(FAKE_MERKLE_HOOK, root, index);
        for (uint256 i; i < signers.length; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(signers[i], digest);
            meta = abi.encodePacked(meta, r, s, v);
        }
    }

    function _aggMeta(bytes memory msigMeta) internal pure returns (bytes memory) {
        uint32 hdr = 3 * 8;
        uint32 end0 = hdr + uint32(msigMeta.length);
        return abi.encodePacked(hdr, end0, end0, end0, end0, end0, msigMeta);
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; i++) out[i] = b[start + i];
    }

    function _keys(uint256 a, uint256 b) internal pure returns (uint256[] memory k) {
        k = new uint256[](2);
        k[0] = a;
        k[1] = b;
    }

    /// deliver next pending message on X1 signed by ETH validators #0,#1
    function _deliverToX1() internal {
        uint32 n = x1Mb.inboundProcessedNonce();
        bytes memory m = x1Mb.inboundMessages(n);
        x1Mb.addInboundMetadata(n, _signMsgId(m, _keys(ethValKeys[0], ethValKeys[1])));
        x1Mb.processNextInboundMessage();
    }

    /// deliver next pending message on ETH signed by X1 validators #0,#2
    function _deliverToEth() internal {
        uint32 n = ethMb.inboundProcessedNonce();
        bytes memory m = ethMb.inboundMessages(n);
        ethMb.addInboundMetadata(n, _aggMeta(_signMsgId(m, _keys(x1ValKeys[0], x1ValKeys[2]))));
        ethMb.processNextInboundMessage();
    }

    function _quoteEthToX1(uint256 amt) internal view returns (uint256) {
        Quote[] memory q = lockbox.quoteTransferRemote(X1_DOMAIN, alice.addressToBytes32(), amt);
        return q[0].amount;
    }

    function _depositFrom(address user, uint256 amt) internal returns (bytes32 id) {
        uint256 fee = _quoteEthToX1(amt);
        vm.startPrank(user);
        vmpx.approve(address(lockbox), amt);
        id = lockbox.transferRemote{value: fee}(X1_DOMAIN, user.addressToBytes32(), amt);
        vm.stopPrank();
    }

    /// collateral invariant in VMPX base units:
    /// lockbox balance == synthetic supply (scaled to 18 dec) + in-flight ETH->X1 + in-flight X1->ETH
    function _inflightEthToX1() internal view returns (uint256 s) {
        for (uint32 i = x1Mb.inboundProcessedNonce(); i < x1Mb.inboundUnprocessedNonce(); i++) {
            s += _amountOf(x1Mb.inboundMessages(i));
        }
    }

    function _inflightX1ToEth() internal view returns (uint256 s) {
        for (uint32 i = ethMb.inboundProcessedNonce(); i < ethMb.inboundUnprocessedNonce(); i++) {
            s += _amountOf(ethMb.inboundMessages(i));
        }
    }

    function _amountOf(bytes memory message) internal pure returns (uint256) {
        // message header = 77 bytes; body = recipient(32) | amount(32)
        return uint256(bytes32(_slice(message, 77 + 32, 32)));
    }

    /// VMPX sent straight to the lockbox (ERC-20 transfer, cannot be prevented): surplus, not a liability
    uint256 internal donated;

    /// solvency (Codex I-01): lockbox >= circulating + in-flight; the difference is exactly the tracked surplus
    function _assertCollateralInvariant() internal view {
        uint256 locked = vmpx.balanceOf(address(lockbox));
        uint256 backed = synth.totalSupply() * 1e9 + _inflightEthToX1() + _inflightX1ToEth();
        assertGe(locked, backed, "lockbox below circulating + in-flight");
        assertEq(locked - backed, donated, "unexplained surplus");
    }
}
