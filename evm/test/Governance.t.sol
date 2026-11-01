// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {BridgeBase} from "./BridgeBase.t.sol";
import {TypeCasts} from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";
import {StaticMessageIdMultisigIsmFactory} from "@hyperlane-xyz/core/contracts/isms/multisig/StaticMultisigIsm.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VmpxCollateralRouter} from "../src/VmpxCollateralRouter.sol";

/// Example "bug-fix" release used to prove the upgrade path keeps state and collateral.
contract VmpxCollateralRouterV2 is VmpxCollateralRouter {
    constructor(address t, address m, uint256 d) VmpxCollateralRouter(t, m, d) {}

    function bridgeVersion() external pure returns (uint256) {
        return 2;
    }
}

/// Emergency controls: fast pause (guardian) and slow change (timelock).
contract GovernanceTest is BridgeBase {
    using TypeCasts for address;

    // ------------------------------------------------ pause: deposits (ETH -> X1)

    function test_guardianPausesDeposits_noFundsTaken() public {
        vm.prank(guardian);
        pauseHook.pause();
        uint256 balBefore = vmpx.balanceOf(alice);
        uint256 ethBefore = alice.balance;
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), 1_000 ether);
        vm.expectRevert("Pausable: paused");
        lockbox.transferRemote{value: 1 ether}(X1_DOMAIN, alice.addressToBytes32(), 1_000 ether);
        vm.stopPrank();
        assertEq(vmpx.balanceOf(alice), balBefore, "atomic revert: tokens untouched");
        assertEq(alice.balance, ethBefore, "atomic revert: ETH untouched");

        vm.prank(guardian);
        pauseHook.unpause();
        _depositFrom(alice, 1_000 ether);
        _deliverToX1();
        assertEq(synth.balanceOf(alice), 1_000e9);
    }

    // ------------------------------------------------ pause: everything at once

    function test_emergencyFullStop_thenResume() public {
        _depositFrom(alice, 2_000 ether); // in flight ETH->X1
        _deliverToX1();
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 500e9); // in flight X1->ETH
        _depositFrom(alice, 300 ether); // another in flight ETH->X1

        // --- incident: guardian stops ETH side, X1 owner switches X1 ISM to the "closed" ISM
        vm.startPrank(guardian);
        pauseHook.pause();
        pauseIsm.pause();
        vm.stopPrank();
        address closedIsm = _closedIsm();
        address openIsm = address(synth.interchainSecurityModule());
        synth.setInterchainSecurityModule(closedIsm); // on X1: Squads -> `token set-interchain-security-module`

        // nothing moves in either direction
        uint32 n = x1Mb.inboundProcessedNonce();
        x1Mb.addInboundMetadata(n, _signMsgId(x1Mb.inboundMessages(n), _keys(ethValKeys[0], ethValKeys[1])));
        vm.expectRevert();
        x1Mb.processNextInboundMessage();
        uint32 m = ethMb.inboundProcessedNonce();
        ethMb.addInboundMetadata(m, _aggMeta(_signMsgId(ethMb.inboundMessages(m), _keys(x1ValKeys[0], x1ValKeys[1]))));
        vm.expectRevert("Pausable: paused");
        ethMb.processNextInboundMessage();
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), 1 ether);
        vm.expectRevert("Pausable: paused");
        lockbox.transferRemote{value: 1 ether}(X1_DOMAIN, alice.addressToBytes32(), 1 ether);
        vm.stopPrank();
        _assertCollateralInvariant(); // all in-flight value still fully backed

        // --- resume: nothing was lost
        synth.setInterchainSecurityModule(openIsm);
        vm.startPrank(guardian);
        pauseIsm.unpause();
        pauseHook.unpause();
        vm.stopPrank();
        x1Mb.processNextInboundMessage();
        ethMb.processNextInboundMessage();
        assertEq(synth.balanceOf(alice), 1_500e9 + 300e9);
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether - 1_800 ether);
        _assertCollateralInvariant();
    }

    function _closedIsm() internal returns (address) {
        // same audited ISM type, validator set nobody controls -> nothing verifies
        address[] memory dead = new address[](1);
        dead[0] = address(0xdEaD);
        return new StaticMessageIdMultisigIsmFactory().deploy(dead, 1);
    }

    // ------------------------------------------------ guardian limits

    function test_guardianCannotUpgradeOrReconfigure() public {
        vm.startPrank(guardian);
        vm.expectRevert("Ownable: caller is not the owner");
        lockbox.setInterchainSecurityModule(address(0));
        vm.expectRevert("Ownable: caller is not the owner");
        proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(lockbox)), address(lockboxImpl));
        vm.stopPrank();
    }

    function test_nonGuardianCannotPause() public {
        vm.startPrank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        pauseHook.pause();
        vm.expectRevert("Ownable: caller is not the owner");
        pauseIsm.pause();
        vm.stopPrank();
    }

    // ------------------------------------------------ upgrade (bug fix) via timelock

    function _scheduleUpgrade(address impl) internal returns (bytes memory data) {
        data = abi.encodeCall(proxyAdmin.upgrade, (ITransparentUpgradeableProxy(address(lockbox)), impl));
        timelock.schedule(address(proxyAdmin), 0, data, bytes32(0), bytes32(0), TIMELOCK_DELAY);
    }

    function test_upgradeThroughTimelockKeepsCollateralAndState() public {
        _depositFrom(alice, 5_000 ether);
        _deliverToX1();
        VmpxCollateralRouterV2 v2 = new VmpxCollateralRouterV2(address(vmpx), address(ethMb), DUST);
        bytes memory data = _scheduleUpgrade(address(v2));

        vm.expectRevert("TimelockController: operation is not ready");
        timelock.execute(address(proxyAdmin), 0, data, bytes32(0), bytes32(0));

        vm.warp(block.timestamp + TIMELOCK_DELAY);
        timelock.execute(address(proxyAdmin), 0, data, bytes32(0), bytes32(0));

        assertEq(VmpxCollateralRouterV2(address(lockbox)).bridgeVersion(), 2);
        assertEq(vmpx.balanceOf(address(lockbox)), 5_000 ether, "collateral untouched by upgrade");
        assertEq(lockbox.routers(X1_DOMAIN), address(synth).addressToBytes32(), "enrollment kept");
        assertEq(address(lockbox.interchainSecurityModule()), ethIsm, "ISM kept");
        // bridge still works both ways after the upgrade
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 5_000e9);
        _deliverToEth();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether);
        _assertCollateralInvariant();
    }

    function test_upgradeCanBeCancelledDuringDelay() public {
        VmpxCollateralRouterV2 v2 = new VmpxCollateralRouterV2(address(vmpx), address(ethMb), DUST);
        bytes memory data = _scheduleUpgrade(address(v2));
        bytes32 id = timelock.hashOperation(address(proxyAdmin), 0, data, bytes32(0), bytes32(0));
        timelock.cancel(id);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert("TimelockController: operation is not ready");
        timelock.execute(address(proxyAdmin), 0, data, bytes32(0), bytes32(0));
    }

    function test_onlyTimelockCanUpgrade() public {
        vm.expectRevert("Ownable: caller is not the owner");
        proxyAdmin.upgrade(ITransparentUpgradeableProxy(address(lockbox)), address(lockboxImpl));
        vm.prank(alice);
        vm.expectRevert(); // not a proposer
        timelock.schedule(address(proxyAdmin), 0, "", bytes32(0), bytes32(0), TIMELOCK_DELAY);
    }

    function test_implementationCannotBeHijacked() public {
        // bare implementation is locked; its storage is irrelevant to the proxy anyway
        vm.prank(alice);
        vm.expectRevert("Initializable: contract is already initialized");
        lockboxImpl.initialize(address(0), address(0), alice);
        vm.prank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        lockbox.setInterchainSecurityModule(address(0));
    }
}
