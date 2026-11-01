// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {BridgeBase} from "./BridgeBase.t.sol";
import {TypeCasts} from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VmpxCollateralRouter} from "../src/VmpxCollateralRouter.sol";
import {VmpxCollateralRouterV2} from "./legacy/VmpxCollateralRouterV2.sol";

/// TVL cap (router v3): deposits stop when the LOCKED balance (net of the fee) would exceed maxLocked;
/// unlocks never check the cap; 0 = deposits closed; type(uint256).max = no cap.
contract MaxLockedTest is BridgeBase {
    using TypeCasts for address;

    address internal vmpxTreasury = address(0x7EA6);
    // ERC-7201 namespace of VmpxCollateralRouter (BridgeFeeStorage): slot = treasury|feeBps, slot + 1 = maxLocked
    bytes32 internal constant BRIDGE_FEE_SLOT = 0x877831e9fe6d41f86d33867c018b5318e4ea9ec1d3b41eca5fcc1a1a6c78a400;

    event MaxLockedSet(uint256 oldMaxLocked, uint256 newMaxLocked);

    function _expectCapRevert(uint256 amount, uint256 lockedAfter, uint256 cap) internal {
        uint256 gas = _quoteEthToX1(amount);
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), amount);
        vm.expectRevert(abi.encodeWithSelector(VmpxCollateralRouter.MaxLockedExceeded.selector, lockedAfter, cap));
        lockbox.transferRemote{value: gas}(X1_DOMAIN, alice.addressToBytes32(), amount);
        vm.stopPrank();
    }

    // -------------------------------------------------------------- boundary

    function test_depositExactlyUpToCapPasses() public {
        lockbox.setMaxLocked(1_000 ether);
        _depositFrom(alice, 1_000 ether);
        assertEq(vmpx.balanceOf(address(lockbox)), 1_000 ether);
        _assertCollateralInvariant();
    }

    function test_oneWeiOverCapReverts() public {
        lockbox.setMaxLocked(1_000 ether - 1);
        _expectCapRevert(1_000 ether, 1_000 ether, 1_000 ether - 1);
        // smallest transferable step (1e-9) over a filled cap
        lockbox.setMaxLocked(1_000 ether);
        _depositFrom(alice, 1_000 ether);
        _expectCapRevert(DUST, 1_000 ether + DUST, 1_000 ether);
    }

    function test_capCountsExistingBalance() public {
        lockbox.setMaxLocked(1_000 ether);
        _depositFrom(alice, 600 ether);
        _depositFrom(alice, 400 ether);
        _expectCapRevert(DUST, 1_000 ether + DUST, 1_000 ether);
    }

    /// with the 3% fee only the net part counts: 1000 gross = 30 to the treasury + 970 locked
    function test_capCountsOnlyLockedPartWithFee() public {
        lockbox.setBridgeFee(300, vmpxTreasury);
        lockbox.setMaxLocked(970 ether);
        _depositFrom(alice, 1_000 ether);
        assertEq(vmpx.balanceOf(address(lockbox)), 970 ether, "locked == cap");
        assertEq(vmpx.balanceOf(vmpxTreasury), 30 ether, "fee not held by the lockbox");
        // 34 units gross -> fee 1 unit, net 33 units
        _expectCapRevert(34 * DUST, 970 ether + 33 * DUST, 970 ether);

        // the next 1000 gross needs exactly cap = 970 + 970, not 970 + 1000
        (, uint256 net) = lockbox.quoteBridgeFee(1_000 ether);
        assertEq(net, 970 ether);
        lockbox.setMaxLocked(970 ether + net - DUST);
        _expectCapRevert(1_000 ether, 970 ether + net, 970 ether + net - DUST);
        lockbox.setMaxLocked(970 ether + net);
        _depositFrom(alice, 1_000 ether);
        _assertCollateralInvariant();
    }

    function testFuzz_capBoundaryWithFee(uint256 units, uint256 bps, uint256 cap) public {
        units = bound(units, 1, 1_000_000e9);
        bps = bound(bps, 0, 500);
        uint256 n = units * DUST;
        lockbox.setBridgeFee(bps, vmpxTreasury);
        (, uint256 net) = lockbox.quoteBridgeFee(n);
        cap = bound(cap, 0, 2 * n);
        lockbox.setMaxLocked(cap);
        if (net <= cap) {
            _depositFrom(alice, n);
            assertEq(vmpx.balanceOf(address(lockbox)), net);
            assertLe(vmpx.balanceOf(address(lockbox)), lockbox.maxLocked());
        } else {
            _expectCapRevert(n, net, cap);
        }
    }

    // ------------------------------------------------------ lowering, unlocks

    function test_lowerBelowBalanceBlocksDepositsNotUnlocks() public {
        _depositFrom(alice, 1_000 ether);
        _deliverToX1();
        lockbox.setMaxLocked(500 ether); // allowed although 1000 is locked
        assertEq(lockbox.maxLocked(), 500 ether);
        _expectCapRevert(DUST, 1_000 ether + DUST, 500 ether);

        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 700e9);
        _deliverToEth(); // unlock while above the cap: never checked
        assertEq(vmpx.balanceOf(address(lockbox)), 300 ether);
        _assertCollateralInvariant();

        _depositFrom(alice, 200 ether); // back under the cap: 300 + 200 == 500
        _expectCapRevert(DUST, 500 ether + DUST, 500 ether);
    }

    function test_zeroClosesDeposits_unlocksStillWork() public {
        _depositFrom(alice, 100 ether);
        _deliverToX1();
        lockbox.setMaxLocked(0);
        _expectCapRevert(DUST, 100 ether + DUST, 0);
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 100e9);
        _deliverToEth();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether);
        _assertCollateralInvariant();
    }

    function test_maxMeansNoCap() public {
        assertEq(lockbox.maxLocked(), type(uint256).max);
        vmpx.mintTo(alice, 100_000_000 ether);
        _depositFrom(alice, 100_000_000 ether);
    }

    /// documented trade-off of measuring with balanceOf: a direct transfer fills the cap (the sender loses it all)
    function test_donationCountsAgainstCap() public {
        lockbox.setMaxLocked(1_000 ether);
        vmpx.mintTo(bob, 1_000 ether);
        vm.prank(bob);
        vmpx.transfer(address(lockbox), 1_000 ether);
        donated += 1_000 ether;
        _expectCapRevert(DUST, 1_000 ether + DUST, 1_000 ether);
        lockbox.setMaxLocked(2_000 ether); // remedy: owner (Timelock) raises the cap by the surplus
        _depositFrom(alice, 1_000 ether);
        _assertCollateralInvariant();
    }

    // ------------------------------------------------------------ access, event

    function test_onlyOwnerSetsMaxLocked() public {
        vm.prank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        lockbox.setMaxLocked(1);
        vm.prank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        lockbox.initializeV3(1);
    }

    function test_setMaxLockedEmits() public {
        vm.expectEmit(true, true, true, true, address(lockbox));
        emit MaxLockedSet(type(uint256).max, 700_000 ether);
        lockbox.setMaxLocked(700_000 ether);
        vm.expectEmit(true, true, true, true, address(lockbox));
        emit MaxLockedSet(700_000 ether, 0);
        lockbox.setMaxLocked(0);
    }

    function test_capChangeOnlyThroughTimelock() public {
        lockbox.transferOwnership(address(timelock));
        vm.expectRevert("Ownable: caller is not the owner");
        lockbox.setMaxLocked(5_000_000 ether);
        bytes memory data = abi.encodeCall(lockbox.setMaxLocked, (5_000_000 ether));
        timelock.schedule(address(lockbox), 0, data, bytes32(0), bytes32(0), TIMELOCK_DELAY);
        vm.expectRevert("TimelockController: operation is not ready");
        timelock.execute(address(lockbox), 0, data, bytes32(0), bytes32(0));
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectEmit(true, true, true, true, address(lockbox));
        emit MaxLockedSet(type(uint256).max, 5_000_000 ether);
        timelock.execute(address(lockbox), 0, data, bytes32(0), bytes32(0));
        assertEq(lockbox.maxLocked(), 5_000_000 ether);
    }

    function test_initializeV3OnlyOnce() public {
        lockbox.initializeV3(700_000 ether);
        assertEq(lockbox.maxLocked(), 700_000 ether);
        vm.expectRevert("Initializable: contract is already initialized");
        lockbox.initializeV3(1);
        lockbox.setMaxLocked(800_000 ether); // the setter keeps working
        assertEq(lockbox.maxLocked(), 800_000 ether);
    }

    function test_implementationCannotBeInitialized() public {
        vm.expectRevert("Initializable: contract is already initialized");
        lockboxImpl.initializeV3(1);
    }

    // -------------------------------------------------------- storage layout

    /// maxLocked is appended to the v2 ERC-7201 struct (slot + 1); slot 0 (treasury | feeBps) is untouched
    function test_storageSlots() public {
        lockbox.setBridgeFee(300, vmpxTreasury);
        lockbox.setMaxLocked(700_000 ether);
        bytes32 s0 = vm.load(address(lockbox), BRIDGE_FEE_SLOT);
        bytes32 s1 = vm.load(address(lockbox), bytes32(uint256(BRIDGE_FEE_SLOT) + 1));
        assertEq(address(uint160(uint256(s0))), vmpxTreasury, "treasury in slot 0 (low 20 bytes)");
        assertEq(uint16(uint256(s0) >> 160), 300, "feeBps packed after treasury");
        assertEq(uint256(s0) >> 176, 0, "nothing else in slot 0");
        assertEq(uint256(s1), 700_000 ether, "maxLocked in slot + 1");
        assertEq(uint256(BRIDGE_FEE_SLOT), uint256(keccak256(abi.encode(uint256(keccak256("vmpx.storage.BridgeFee")) - 1))) & ~uint256(0xff));
    }

    // ------------------------------------------------------- upgrade v2 -> v3

    /// puts the BridgeBase proxy back on the frozen v2 with v2-era storage (v2 never wrote slot + 1)
    function _onV2WithFee() internal {
        VmpxCollateralRouterV2 v2 = new VmpxCollateralRouterV2(address(vmpx), address(ethMb), DUST);
        vm.prank(address(timelock));
        proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(lockbox)), address(v2));
        vm.store(address(lockbox), bytes32(uint256(BRIDGE_FEE_SLOT) + 1), bytes32(0));
        VmpxCollateralRouterV2(address(lockbox)).setBridgeFee(300, vmpxTreasury);
        _depositFrom(alice, 5_000 ether); // 150 fee, 4850 locked
        _deliverToX1();
        lockbox.transferOwnership(address(timelock));
    }

    /// The real path on Sepolia/mainnet: proxy runs v2, one Timelock batch = upgrade + initializeV3.
    function test_upgradeFromV2InOneBatch() public {
        _onV2WithFee();
        uint256 locked = vmpx.balanceOf(address(lockbox));
        assertEq(locked, 4_850 ether);

        VmpxCollateralRouter v3 = new VmpxCollateralRouter(address(vmpx), address(ethMb), DUST);
        address[] memory t = new address[](2);
        uint256[] memory v = new uint256[](2);
        bytes[] memory d = new bytes[](2);
        t[0] = address(proxyAdmin);
        d[0] = abi.encodeCall(proxyAdmin.upgrade, (ITransparentUpgradeableProxy(address(lockbox)), address(v3)));
        t[1] = address(lockbox);
        d[1] = abi.encodeCall(lockbox.initializeV3, (5_000_000 ether));
        bytes32 salt = keccak256("router-v3");
        timelock.scheduleBatch(t, v, d, bytes32(0), salt, TIMELOCK_DELAY);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectEmit(true, true, true, true, address(lockbox));
        emit MaxLockedSet(0, 5_000_000 ether);
        timelock.executeBatch(t, v, d, bytes32(0), salt);

        assertEq(proxyAdmin.getProxyImplementation(ITransparentUpgradeableProxy(address(lockbox))), address(v3));
        assertEq(lockbox.maxLocked(), 5_000_000 ether);
        assertEq(lockbox.bridgeFeeBps(), 300, "fee kept");
        assertEq(lockbox.treasury(), vmpxTreasury, "treasury kept");
        assertEq(lockbox.owner(), address(timelock), "owner kept");
        assertEq(lockbox.routers(X1_DOMAIN), address(synth).addressToBytes32(), "enrollment kept");
        assertEq(address(lockbox.interchainSecurityModule()), ethIsm, "ISM kept");
        assertEq(vmpx.balanceOf(address(lockbox)), locked, "collateral untouched");
        assertEq(vmpx.balanceOf(vmpxTreasury), 150 ether, "treasury balance untouched");
        assertEq(synth.totalSupply(), 4_850e9, "X1 supply untouched");
        _assertCollateralInvariant();

        // initializeV3 is single-use, even for the Timelock
        bytes memory again = abi.encodeCall(lockbox.initializeV3, (1));
        timelock.schedule(address(lockbox), 0, again, bytes32(0), bytes32(0), TIMELOCK_DELAY);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert("TimelockController: underlying transaction reverted");
        timelock.execute(address(lockbox), 0, again, bytes32(0), bytes32(0));

        // bridge keeps working both ways under the cap
        _depositFrom(alice, 1_000 ether);
        _deliverToX1();
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 5_820e9);
        _deliverToEth();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether - 180 ether, "only the 3% fees are gone");
        assertEq(vmpx.balanceOf(address(lockbox)), 0);
        _assertCollateralInvariant();
    }

    /// Forgetting initializeV3 fails CLOSED: deposits revert (cap 0), unlocks keep working, setMaxLocked repairs it.
    function test_upgradeWithoutInitializeV3FailsClosed() public {
        _onV2WithFee();
        VmpxCollateralRouter v3 = new VmpxCollateralRouter(address(vmpx), address(ethMb), DUST);
        vm.prank(address(timelock));
        proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(lockbox)), address(v3));
        assertEq(lockbox.maxLocked(), 0);

        (, uint256 net) = lockbox.quoteBridgeFee(1_000 ether);
        _expectCapRevert(1_000 ether, 4_850 ether + net, 0);

        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 4_850e9);
        _deliverToEth();
        assertEq(vmpx.balanceOf(address(lockbox)), 0, "unlock not blocked");

        vm.prank(address(timelock));
        lockbox.setMaxLocked(5_000_000 ether);
        _depositFrom(alice, 1_000 ether);
        _assertCollateralInvariant();
    }
}

/// Stateful fuzzing of the cap: deposits, unlocks, cap and fee changes in any order.
contract MaxLockedInvariantTest is BridgeBase {
    using TypeCasts for address;

    address internal vmpxTreasury = address(0x7EA6);
    uint256 internal falseAccepts; // a deposit went through although balance + net > cap
    uint256 internal falseRejects; // a deposit reverted although balance + net <= cap
    uint256 internal balanceAtCapChange; // balance when the cap was last changed (lowering below it is allowed)

    function setUp() public override {
        super.setUp();
        lockbox.setBridgeFee(300, vmpxTreasury);
        lockbox.setMaxLocked(100_000 ether);
        targetContract(address(this));
        bytes4[] memory sel = new bytes4[](6);
        sel[0] = this.h_deposit.selector;
        sel[1] = this.h_burn.selector;
        sel[2] = this.h_deliverX1.selector;
        sel[3] = this.h_deliverEth.selector;
        sel[4] = this.h_setCap.selector;
        sel[5] = this.h_setFee.selector;
        targetSelector(FuzzSelector({addr: address(this), selectors: sel}));
    }

    function h_deposit(uint256 units) external {
        units = bound(units, 1, 50_000e9);
        uint256 n = units * DUST;
        vmpx.mintTo(alice, n);
        (, uint256 net) = lockbox.quoteBridgeFee(n);
        uint256 room = vmpx.balanceOf(address(lockbox)) + net;
        uint256 gas = _quoteEthToX1(n);
        vm.prank(alice);
        vmpx.approve(address(lockbox), n);
        vm.prank(alice);
        try lockbox.transferRemote{value: gas}(X1_DOMAIN, alice.addressToBytes32(), n) {
            if (room > lockbox.maxLocked()) falseAccepts++;
        } catch {
            if (room <= lockbox.maxLocked()) falseRejects++;
        }
    }

    function h_burn(uint256 units) external {
        uint256 bal = synth.balanceOf(alice);
        if (bal == 0) return;
        units = bound(units, 1, bal);
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), units);
    }

    function h_deliverX1() external {
        if (x1Mb.inboundProcessedNonce() < x1Mb.inboundUnprocessedNonce()) _deliverToX1();
    }

    function h_deliverEth() external {
        if (ethMb.inboundProcessedNonce() < ethMb.inboundUnprocessedNonce()) _deliverToEth();
    }

    function h_setCap(uint256 cap, bool unlimited) external {
        cap = unlimited ? type(uint256).max : bound(cap, 0, 300_000 ether);
        lockbox.setMaxLocked(cap);
        balanceAtCapChange = vmpx.balanceOf(address(lockbox));
    }

    function h_setFee(uint256 bps) external {
        lockbox.setBridgeFee(bound(bps, 0, 500), vmpxTreasury);
    }

    function invariant_noDepositPastCap() public view {
        assertEq(falseAccepts, 0, "deposit accepted above the cap");
        assertEq(falseRejects, 0, "deposit rejected below the cap");
    }

    /// locked never exceeds the cap, except a balance that was already there when the cap was lowered
    function invariant_lockedWithinCap() public view {
        uint256 cap = lockbox.maxLocked();
        uint256 limit = cap > balanceAtCapChange ? cap : balanceAtCapChange;
        assertLe(vmpx.balanceOf(address(lockbox)), limit);
    }

    function invariant_fullyCollateralized() public view {
        _assertCollateralInvariant();
    }
}
