// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {BridgeBase} from "./BridgeBase.t.sol";
import {TypeCasts} from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";
import {TransparentUpgradeableProxy, ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VmpxCollateralRouter} from "../src/VmpxCollateralRouter.sol";
import {VmpxCollateralRouterV1} from "./legacy/VmpxCollateralRouterV1.sol";

/// Bridge fee in VMPX (router v2): deducted from the amount, sent to the treasury, lockbox == X1 supply.
contract BridgeFeeTest is BridgeBase {
    using TypeCasts for address;

    address internal vmpxTreasury = address(0x7EA6);
    uint256 internal constant BPS = 300;

    event BridgeFeeTaken(bytes32 indexed messageId, address indexed payer, uint256 gross, uint256 fee);

    function _enableFee() internal {
        lockbox.setBridgeFee(BPS, vmpxTreasury);
    }

    // ------------------------------------------------------------- amounts

    function test_feeDeductedNotAdded() public {
        _enableFee();
        uint256 n = 1_000 ether;
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), n); // allowance of exactly N is enough
        uint256 gas = _quoteEthToX1(n);
        vm.expectEmit(false, true, false, true, address(lockbox));
        emit BridgeFeeTaken(bytes32(0), alice, n, 30 ether);
        lockbox.transferRemote{value: gas}(X1_DOMAIN, alice.addressToBytes32(), n);
        vm.stopPrank();

        assertEq(vmpx.balanceOf(alice), 1_000_000 ether - n, "pulled exactly N");
        assertEq(vmpx.allowance(alice, address(lockbox)), 0);
        assertEq(vmpx.balanceOf(vmpxTreasury), 30 ether, "3% to treasury");
        assertEq(vmpx.balanceOf(address(lockbox)), 970 ether, "lockbox holds N - fee");
        _assertCollateralInvariant(); // in flight: 970
        _deliverToX1();
        assertEq(synth.balanceOf(alice), 970e9, "X1 mints N - fee");
        _assertCollateralInvariant();
    }

    function test_quoteMatchesCharge() public {
        _enableFee();
        (uint256 fee, uint256 net) = lockbox.quoteBridgeFee(12_345.678901234 ether);
        _depositFrom(alice, 12_345.678901234 ether);
        assertEq(vmpx.balanceOf(vmpxTreasury), fee);
        assertEq(vmpx.balanceOf(address(lockbox)), net);
        assertEq(fee, 370.370367037 ether); // 3% = 370.37036703702 -> rounded down to 1e-9
    }

    function test_returnTripHasNoVmpxFee() public {
        _enableFee();
        _depositFrom(alice, 1_000 ether);
        _deliverToX1();
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 970e9);
        _deliverToEth();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether - 30 ether, "only the 3% is gone");
        assertEq(vmpx.balanceOf(address(lockbox)), 0);
        _assertCollateralInvariant();
    }

    function test_zeroFeeBehavesLikeV1() public {
        _depositFrom(alice, 1_000 ether);
        assertEq(vmpx.balanceOf(address(lockbox)), 1_000 ether);
        assertEq(lockbox.bridgeFeeBps(), 0);
    }

    // ----------------------------------------------------------- rounding

    function testFuzz_roundingToDust(uint256 units, uint256 bps) public {
        units = bound(units, 1, 1_000_000e9); // 1e-9 .. 1,000,000 VMPX
        bps = bound(bps, 0, 500);
        uint256 n = units * DUST;
        lockbox.setBridgeFee(bps, vmpxTreasury);
        (uint256 fee, uint256 net) = lockbox.quoteBridgeFee(n);
        uint256 exact = (n * bps) / 10_000;
        assertEq(fee % DUST, 0, "fee multiple of 1e-9");
        assertEq(net % DUST, 0, "net multiple of 1e-9");
        assertLe(fee, exact, "rounded down (never above the rate)");
        assertLt(exact - fee, DUST, "loses less than 1e-9");
        assertLt(fee, n, "fee always below amount");
        assertEq(fee + net, n);

        _depositFrom(alice, n);
        assertEq(vmpx.balanceOf(vmpxTreasury), fee);
        assertEq(vmpx.balanceOf(address(lockbox)), net);
        _assertCollateralInvariant();
    }

    function test_tinyAmountsPayNoFee() public {
        _enableFee();
        // 3% of 33 units = 0.99 unit -> 0; 34 units -> 1.02 -> 1 unit
        (uint256 f33, ) = lockbox.quoteBridgeFee(33 * DUST);
        (uint256 f34, ) = lockbox.quoteBridgeFee(34 * DUST);
        assertEq(f33, 0);
        assertEq(f34, DUST);
        _depositFrom(alice, DUST); // 1e-9 VMPX still bridges, fee 0, no event needed
        assertEq(vmpx.balanceOf(address(lockbox)), DUST);
    }

    // ------------------------------------------------------------ ceiling

    function test_ceilingIs500Bps() public {
        assertEq(lockbox.MAX_FEE_BPS(), 500);
        vm.expectRevert(abi.encodeWithSelector(VmpxCollateralRouter.FeeAboveMax.selector, 501, 500));
        lockbox.setBridgeFee(501, vmpxTreasury);
        lockbox.setBridgeFee(500, vmpxTreasury);
        _depositFrom(alice, 1_000 ether);
        assertEq(vmpx.balanceOf(vmpxTreasury), 50 ether);
    }

    function test_badTreasuryRejected() public {
        vm.expectRevert(VmpxCollateralRouter.InvalidTreasury.selector);
        lockbox.setBridgeFee(BPS, address(0));
        vm.expectRevert(VmpxCollateralRouter.InvalidTreasury.selector);
        lockbox.setBridgeFee(BPS, address(lockbox));
        lockbox.setBridgeFee(0, address(0)); // fee off, no treasury needed
    }

    function test_onlyOwnerSetsFee() public {
        vm.prank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        lockbox.setBridgeFee(BPS, alice);
    }

    // ------------------------------------------------------------ attacks

    function test_zeroAmountReverts() public {
        _enableFee();
        vm.prank(alice);
        vm.expectRevert(VmpxCollateralRouter.ZeroAmount.selector);
        lockbox.transferRemote(X1_DOMAIN, alice.addressToBytes32(), 0);
    }

    function test_nonDustAmountReverts() public {
        _enableFee();
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), 1 ether + 1);
        vm.expectRevert(abi.encodeWithSelector(VmpxCollateralRouter.AmountNotMultipleOfDustUnit.selector, 1 ether + 1, DUST));
        lockbox.transferRemote(X1_DOMAIN, alice.addressToBytes32(), 1 ether + 1);
        vm.stopPrank();
    }

    /// fee >= amount is unreachable: fee <= 5% of amount for every amount >= 1 unit
    function testFuzz_feeNeverReachesAmount(uint256 n) public {
        n = bound(n, 1, type(uint128).max);
        lockbox.setBridgeFee(500, vmpxTreasury);
        (uint256 fee, uint256 net) = lockbox.quoteBridgeFee(n);
        assertLt(fee, n);
        assertGt(net, 0);
    }

    function test_noExtraPullBeyondApproval() public {
        _enableFee();
        // a standing allowance larger than N must not be used beyond N
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), type(uint256).max);
        uint256 gas = _quoteEthToX1(100 ether);
        lockbox.transferRemote{value: gas}(X1_DOMAIN, alice.addressToBytes32(), 100 ether);
        vm.stopPrank();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether - 100 ether);
    }

    function test_insufficientApprovalReverts() public {
        _enableFee();
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), 99 ether);
        uint256 gas = _quoteEthToX1(100 ether);
        vm.expectRevert("ERC20: insufficient allowance");
        lockbox.transferRemote{value: gas}(X1_DOMAIN, alice.addressToBytes32(), 100 ether);
        vm.stopPrank();
    }

    function test_tokenFeeHookStillBlocked() public {
        _enableFee();
        lockbox.setFeeHook(address(0xFEE));
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), 1 ether);
        vm.expectRevert(VmpxCollateralRouter.TokenFeeHookNotAllowed.selector);
        lockbox.transferRemote(X1_DOMAIN, alice.addressToBytes32(), 1 ether);
        vm.stopPrank();
    }

    // ------------------------------------------------ change through Timelock

    function test_feeChangeOnlyThroughTimelock() public {
        lockbox.transferOwnership(address(timelock));
        bytes memory data = abi.encodeCall(lockbox.setBridgeFee, (BPS, vmpxTreasury));
        vm.expectRevert("Ownable: caller is not the owner");
        lockbox.setBridgeFee(BPS, vmpxTreasury);

        timelock.schedule(address(lockbox), 0, data, bytes32(0), bytes32(0), TIMELOCK_DELAY);
        vm.expectRevert("TimelockController: operation is not ready");
        timelock.execute(address(lockbox), 0, data, bytes32(0), bytes32(0));
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        timelock.execute(address(lockbox), 0, data, bytes32(0), bytes32(0));
        assertEq(lockbox.bridgeFeeBps(), BPS);
        assertEq(lockbox.treasury(), vmpxTreasury);

        // above the immutable ceiling: even the timelock cannot
        bytes memory bad = abi.encodeCall(lockbox.setBridgeFee, (501, vmpxTreasury));
        timelock.schedule(address(lockbox), 0, bad, bytes32(0), bytes32(0), TIMELOCK_DELAY);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert("TimelockController: underlying transaction reverted");
        timelock.execute(address(lockbox), 0, bad, bytes32(0), bytes32(0));
    }

    /// The real path on Sepolia/mainnet: proxy runs v1, one Timelock batch = upgrade + setBridgeFee.
    function test_upgradeFromV1InOneBatch() public {
        VmpxCollateralRouterV1 v1 = new VmpxCollateralRouterV1(address(vmpx), address(ethMb), DUST);
        vm.prank(address(timelock));
        proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(lockbox)), address(v1));
        _depositFrom(alice, 5_000 ether);
        _deliverToX1();
        lockbox.transferOwnership(address(timelock));

        VmpxCollateralRouter v2 = new VmpxCollateralRouter(address(vmpx), address(ethMb), DUST);
        address[] memory t = new address[](2);
        uint256[] memory v = new uint256[](2);
        bytes[] memory d = new bytes[](2);
        t[0] = address(proxyAdmin);
        d[0] = abi.encodeCall(proxyAdmin.upgrade, (ITransparentUpgradeableProxy(address(lockbox)), address(v2)));
        t[1] = address(lockbox);
        d[1] = abi.encodeCall(lockbox.setBridgeFee, (BPS, vmpxTreasury));
        bytes32 salt = keccak256("router-v2");
        timelock.scheduleBatch(t, v, d, bytes32(0), salt, TIMELOCK_DELAY);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        timelock.executeBatch(t, v, d, bytes32(0), salt);

        assertEq(lockbox.bridgeFeeBps(), BPS);
        assertEq(lockbox.owner(), address(timelock), "owner kept");
        assertEq(lockbox.routers(X1_DOMAIN), address(synth).addressToBytes32(), "enrollment kept");
        assertEq(address(lockbox.interchainSecurityModule()), ethIsm, "ISM kept");
        assertEq(vmpx.balanceOf(address(lockbox)), 5_000 ether, "collateral untouched");
        _assertCollateralInvariant();

        _depositFrom(alice, 1_000 ether);
        _deliverToX1();
        assertEq(synth.balanceOf(alice), 5_970e9);
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 5_970e9);
        _deliverToEth();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether - 30 ether);
        assertEq(vmpx.balanceOf(vmpxTreasury), 30 ether);
        _assertCollateralInvariant();
    }
}

/// Stateful fuzzing with the fee on: lockbox == X1 supply + in-flight, and no value is created or lost.
contract BridgeFeeInvariantTest is BridgeBase {
    using TypeCasts for address;

    address internal vmpxTreasury = address(0x7EA6);

    function setUp() public override {
        super.setUp();
        lockbox.setBridgeFee(300, vmpxTreasury);
        targetContract(address(this));
        bytes4[] memory sel = new bytes4[](5);
        sel[0] = this.h_deposit.selector;
        sel[1] = this.h_burn.selector;
        sel[2] = this.h_deliverX1.selector;
        sel[3] = this.h_deliverEth.selector;
        sel[4] = this.h_setFee.selector;
        targetSelector(FuzzSelector({addr: address(this), selectors: sel}));
    }

    function h_deposit(uint256 units) external {
        units = bound(units, 1, 5_000e9);
        _depositFrom(alice, units * DUST);
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

    function h_setFee(uint256 bps) external {
        lockbox.setBridgeFee(bound(bps, 0, 500), vmpxTreasury);
    }

    function invariant_fullyCollateralized() public view {
        _assertCollateralInvariant();
    }

    function invariant_valueConserved() public view {
        assertEq(vmpx.balanceOf(alice) + vmpx.balanceOf(address(lockbox)) + vmpx.balanceOf(vmpxTreasury), 1_000_000 ether);
    }
}
