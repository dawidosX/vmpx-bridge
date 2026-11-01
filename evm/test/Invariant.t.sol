// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {BridgeBase} from "./BridgeBase.t.sol";
import {TypeCasts} from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";

/// Stateful fuzzing: random deposits, burns, (delayed) deliveries, pauses.
/// Invariant: lockbox VMPX == synthetic supply * 1e9 + in-flight (both directions).
contract InvariantTest is BridgeBase {
    using TypeCasts for address;

    function setUp() public override {
        super.setUp();
        targetContract(address(this));
        bytes4[] memory sel = new bytes4[](6);
        sel[0] = this.h_deposit.selector;
        sel[1] = this.h_burn.selector;
        sel[2] = this.h_deliverX1.selector;
        sel[3] = this.h_deliverEth.selector;
        sel[4] = this.h_togglePause.selector;
        sel[5] = this.h_transferDirect.selector;
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
        if (ethMb.inboundProcessedNonce() >= ethMb.inboundUnprocessedNonce()) return;
        if (pauseIsm.paused()) return;
        _deliverToEth();
    }

    /// a third party sends VMPX straight to the lockbox (no message, no X1 supply): surplus only
    function h_transferDirect(uint256 units) external {
        units = bound(units, 1, 1_000e9);
        vmpx.mintTo(bob, units);
        vm.prank(bob);
        vmpx.transfer(address(lockbox), units);
        donated += units;
    }

    function h_togglePause() external {
        vm.prank(guardian);
        if (pauseIsm.paused()) pauseIsm.unpause();
        else pauseIsm.pause();
    }

    function invariant_fullyCollateralized() public view {
        _assertCollateralInvariant();
    }

    function invariant_userValueConserved() public view {
        // alice's VMPX + locked-on-her-behalf == initial 1,000,000 (single user scenario)
        assertEq(vmpx.balanceOf(alice) + vmpx.balanceOf(address(lockbox)) - donated, 1_000_000 ether);
    }
}
