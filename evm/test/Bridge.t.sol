// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {BridgeBase} from "./BridgeBase.t.sol";
import {TypeCasts} from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";
import {HypERC20} from "@hyperlane-xyz/core/contracts/token/HypERC20.sol";
import {ITokenBridge} from "@hyperlane-xyz/core/contracts/interfaces/ITokenBridge.sol";
import {VmpxCollateralRouter} from "../src/VmpxCollateralRouter.sol";
import {VmpxEthFeeHook} from "../src/VmpxEthFeeHook.sol";

contract RevertingReceiver {
    receive() external payable {
        revert("no");
    }
}

contract BridgeTest is BridgeBase {
    using TypeCasts for address;

    // ======================================================== 1. happy path

    function test_fullRoundTrip() public {
        uint256 amt = 1_000 ether;
        uint256 ethBefore = alice.balance;
        uint256 fee = _quoteEthToX1(amt);

        _depositFrom(alice, amt);
        assertEq(vmpx.balanceOf(address(lockbox)), amt);
        assertEq(alice.balance, ethBefore - fee, "exact fee charged");
        _assertCollateralInvariant();

        _deliverToX1();
        assertEq(synth.balanceOf(alice), 1_000e9, "9-dec representation minted 1:1");
        _assertCollateralInvariant();

        // back to Ethereum
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 400e9);
        _assertCollateralInvariant(); // in flight X1->ETH
        _deliverToEth();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether - 600 ether);
        assertEq(vmpx.balanceOf(address(lockbox)), 600 ether);
        _assertCollateralInvariant();
    }

    function test_feeIsThreePercentOfReferenceValue() public view {
        uint256 amt = 10_000 ether;
        (uint256 fee, bool stale) = feeHook.feeFor(amt);
        // 10_000 * 4e11 wei = 4e15 wei value; 3% = 1.2e14 -> below min 2e14
        assertFalse(stale);
        assertEq(fee, 0.0002 ether, "min fee applies");
        (fee, ) = feeHook.feeFor(1_000_000 ether); // value 0.4 ETH -> 3% = 0.012 ETH
        assertEq(fee, 0.012 ether);
        (fee, ) = feeHook.feeFor(100_000_000 ether); // capped
        assertEq(fee, 0.02 ether);
    }

    // ======================================================== 2. fee enforcement

    function test_underpaymentReverts() public {
        uint256 fee = _quoteEthToX1(1_000 ether);
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), 1_000 ether);
        vm.expectRevert();
        lockbox.transferRemote{value: fee - 1}(X1_DOMAIN, alice.addressToBytes32(), 1_000 ether);
        vm.expectRevert();
        lockbox.transferRemote{value: 0}(X1_DOMAIN, alice.addressToBytes32(), 1_000 ether);
        vm.stopPrank();
    }

    function test_overpaymentRefunded() public {
        uint256 fee = _quoteEthToX1(1_000 ether);
        uint256 before = alice.balance;
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), 1_000 ether);
        lockbox.transferRemote{value: fee + 1 ether}(X1_DOMAIN, alice.addressToBytes32(), 1_000 ether);
        vm.stopPrank();
        assertEq(alice.balance, before - fee, "excess refunded to sender");
        assertEq(address(feeHook).balance, fee);
    }

    function test_hookRejectsForeignRouter() public {
        // A different router trying to use our hook (e.g. to look like it paid) is rejected.
        bytes memory body = abi.encodePacked(alice.addressToBytes32(), uint256(1 ether));
        bytes memory foreign = ethMb.buildMessage(address(0xdead), X1_DOMAIN, alice.addressToBytes32(), body);
        vm.expectRevert(abi.encodeWithSelector(VmpxEthFeeHook.WrongSender.selector, address(0xdead)));
        feeHook.quoteDispatch("", foreign);
    }

    function test_onlyOwnerCanChangeHookOrIsm() public {
        vm.startPrank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        lockbox.setHook(address(0));
        vm.expectRevert("Ownable: caller is not the owner");
        lockbox.setInterchainSecurityModule(address(0));
        vm.expectRevert("Ownable: caller is not the owner");
        lockbox.enrollRemoteRouter(X1_DOMAIN, bytes32(uint256(1)));
        vm.stopPrank();
    }

    // ======================================================== 3. decimals & dust

    function test_dustAmountReverts() public {
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(VmpxCollateralRouter.AmountNotMultipleOfDustUnit.selector, 1 ether + 1, DUST));
        lockbox.transferRemote{value: 1 ether}(X1_DOMAIN, alice.addressToBytes32(), 1 ether + 1);
        vm.expectRevert(VmpxCollateralRouter.ZeroAmount.selector);
        lockbox.transferRemote{value: 1 ether}(X1_DOMAIN, alice.addressToBytes32(), 0);
        vm.expectRevert("recipient=0");
        lockbox.transferRemote{value: 1 ether}(X1_DOMAIN, bytes32(0), 1 ether);
        vm.stopPrank();
    }

    function test_smallestUnitRoundTrip() public {
        _depositFrom(alice, DUST); // 1e-9 VMPX
        _deliverToX1();
        assertEq(synth.balanceOf(alice), 1);
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 1);
        _deliverToEth();
        assertEq(vmpx.balanceOf(address(lockbox)), 0);
        _assertCollateralInvariant();
    }

    function test_u64Bounds() public pure {
        uint256 capAt9 = 108_624_000 * 1e9;
        uint256 capAt18 = 108_624_000 * 1e18;
        assertLt(capAt9, type(uint64).max, "whole cap fits SPL u64 at 9 decimals");
        assertGt(capAt18, type(uint64).max, "18 decimals on SVM would overflow u64");
    }

    function testFuzz_scalingIsLossless(uint256 units) public {
        units = bound(units, 1, 50_000e9);
        uint256 amt = units * DUST;
        _depositFrom(alice, amt);
        _deliverToX1();
        assertEq(synth.balanceOf(alice), units);
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), units);
        _deliverToEth();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether);
        _assertCollateralInvariant();
    }

    // ======================================================== 4. replay / redelivery

    function test_replayOnEthReverts() public {
        _depositFrom(alice, 1_000 ether);
        _deliverToX1();
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 1_000e9);
        _deliverToEth();
        // try to process the very same message (nonce 0) again
        vm.expectRevert("Mailbox: already delivered");
        ethMb.processInboundMessage(0);
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether);
    }

    function test_replayOnX1Reverts() public {
        _depositFrom(alice, 1_000 ether);
        _deliverToX1();
        vm.expectRevert("Mailbox: already delivered");
        x1Mb.processInboundMessage(0);
        assertEq(synth.totalSupply(), 1_000e9);
    }

    function test_delayedDeliveryStillWorksOnce() public {
        _depositFrom(alice, 500 ether);
        vm.warp(block.timestamp + 30 days); // relayer down for a month
        _deliverToX1();
        assertEq(synth.balanceOf(alice), 500e9);
    }

    // ======================================================== 5. signatures / threshold

    function _pendingToEth(uint256 amt9) internal returns (uint32 n, bytes memory m) {
        _depositFrom(alice, amt9 * DUST);
        _deliverToX1();
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), amt9);
        n = ethMb.inboundProcessedNonce();
        m = ethMb.inboundMessages(n);
    }

    function test_fakeSignaturesRejected() public {
        (uint32 n, bytes memory m) = _pendingToEth(1_000e9);
        ethMb.addInboundMetadata(n, _aggMeta(_signMsgId(m, _keys(0xBAD1, 0xBAD2))));
        vm.expectRevert("!threshold");
        ethMb.processNextInboundMessage();
        assertEq(vmpx.balanceOf(address(lockbox)), 1_000 ether);
    }

    function test_belowThresholdRejected() public {
        (uint32 n, bytes memory m) = _pendingToEth(1_000e9);
        uint256[] memory one = new uint256[](1);
        one[0] = x1ValKeys[0];
        ethMb.addInboundMetadata(n, _aggMeta(_signMsgId(m, one)));
        vm.expectRevert();
        ethMb.processNextInboundMessage();
    }

    function test_duplicateSignerRejected() public {
        (uint32 n, bytes memory m) = _pendingToEth(1_000e9);
        ethMb.addInboundMetadata(n, _aggMeta(_signMsgId(m, _keys(x1ValKeys[0], x1ValKeys[0]))));
        vm.expectRevert("!threshold");
        ethMb.processNextInboundMessage();
    }

    function test_ethValidatorsCannotAttestX1Messages() public {
        // keys valid for the other direction must not work here
        (uint32 n, bytes memory m) = _pendingToEth(1_000e9);
        ethMb.addInboundMetadata(n, _aggMeta(_signMsgId(m, _keys(ethValKeys[0], ethValKeys[1]))));
        vm.expectRevert("!threshold");
        ethMb.processNextInboundMessage();
    }

    // ======================================================== 6. wrong domain / router / tampering

    function test_unenrolledRouterOnX1CannotUnlock() public {
        // attacker deploys their own synthetic on X1 and sends a valid, correctly *signed* message
        HypERC20 evil = new HypERC20(9, 1e9, 1, address(x1Mb));
        evil.initialize(1_000_000e9, "evil", "EVIL", address(0), x1Ism, address(this));
        evil.enrollRemoteRouter(ETH, address(lockbox).addressToBytes32());
        _depositFrom(alice, 1_000 ether); // real collateral exists
        _deliverToX1();
        evil.transferRemote(ETH, bob.addressToBytes32(), 1_000e9);
        uint32 n = ethMb.inboundProcessedNonce();
        bytes memory m = ethMb.inboundMessages(n);
        ethMb.addInboundMetadata(n, _aggMeta(_signMsgId(m, _keys(x1ValKeys[0], x1ValKeys[1]))));
        vm.expectRevert("Enrolled router does not match sender"); // "No router enrolled for domain" / sender mismatch
        ethMb.processNextInboundMessage();
        assertEq(vmpx.balanceOf(bob), 0);
    }

    function test_unknownOriginDomainRejected() public {
        uint32 OTHER = 999;
        // build a message that claims to come from domain 999 with our synth as sender
        bytes memory body = abi.encodePacked(bob.addressToBytes32(), uint256(1 ether));
        bytes memory m = abi.encodePacked(
            uint8(3), uint32(0), OTHER, address(synth).addressToBytes32(), ETH, address(lockbox).addressToBytes32(), body
        );
        ethMb.addInboundMessage(m);
        uint32 n = ethMb.inboundProcessedNonce();
        ethMb.addInboundMetadata(n, _aggMeta(_signMsgId(m, _keys(x1ValKeys[0], x1ValKeys[1]))));
        vm.expectRevert("No router enrolled for domain: 999");
        ethMb.processNextInboundMessage();
    }

    function test_tamperedAmountRejected() public {
        (uint32 n, bytes memory m) = _pendingToEth(1e9);
        bytes memory sigs = _aggMeta(_signMsgId(m, _keys(x1ValKeys[0], x1ValKeys[1])));
        // relayer swaps in a message with a bigger amount but reuses signatures
        bytes memory forged = abi.encodePacked(_slice(m, 0, 77 + 32), uint256(999_999 ether));
        ethMb.addInboundMessage(forged);
        uint32 forgedNonce = ethMb.inboundUnprocessedNonce() - 1;
        ethMb.addInboundMetadata(forgedNonce, sigs);
        vm.expectRevert("!threshold");
        ethMb.processInboundMessage(forgedNonce);
        // the genuine one still works
        ethMb.addInboundMetadata(n, sigs);
        ethMb.processInboundMessage(n);
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether);
    }

    function test_wrongDestinationDomainOnHook() public {
        bytes memory body = abi.encodePacked(alice.addressToBytes32(), uint256(1 ether));
        vm.prank(address(lockbox));
        bytes memory m = ethMb.buildMessage(address(lockbox), 777, alice.addressToBytes32(), body);
        vm.expectRevert(abi.encodeWithSelector(VmpxEthFeeHook.WrongDestination.selector, uint32(777)));
        feeHook.quoteDispatch("", m);
    }

    // ======================================================== 7. pause / rate limit / recovery

    function test_pauseBlocksUnlockAndResumeRecovers() public {
        _pendingToEth(1_000e9);
        vm.prank(guardian);
        pauseIsm.pause();
        uint32 n = ethMb.inboundProcessedNonce();
        bytes memory m = ethMb.inboundMessages(n);
        ethMb.addInboundMetadata(n, _aggMeta(_signMsgId(m, _keys(x1ValKeys[0], x1ValKeys[1]))));
        vm.expectRevert("Pausable: paused");
        ethMb.processNextInboundMessage();
        _assertCollateralInvariant(); // message stays in-flight, collateral intact
        vm.prank(guardian);
        pauseIsm.unpause();
        ethMb.processNextInboundMessage();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether);
        _assertCollateralInvariant();
    }

    function test_rateLimitCapsUnlocks() public {
        uint256 big = RATE_CAP + 1_000 ether;
        vmpx.mintTo(alice, big);
        _depositFrom(alice, big);
        _deliverToX1();
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), big / 1e9);
        uint32 n = ethMb.inboundProcessedNonce();
        bytes memory m = ethMb.inboundMessages(n);
        ethMb.addInboundMetadata(n, _aggMeta(_signMsgId(m, _keys(x1ValKeys[0], x1ValKeys[1]))));
        vm.expectRevert("RateLimitExceeded");
        ethMb.processNextInboundMessage();
        _assertCollateralInvariant();
    }

    function test_unlockWorksWhenTreasuryBroken() public {
        // fee beneficiary that cannot receive ETH + stale price: bridge must keep working
        feeHook.setBeneficiary(payable(address(new RevertingReceiver())));
        _depositFrom(alice, 1_000 ether);
        vm.expectRevert();
        feeHook.withdrawFees();
        vm.warp(block.timestamp + 10 days); // price stale
        _deliverToX1();
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 1_000e9);
        _deliverToEth();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether);
        // deposits continue with the public stale fallback fee
        (uint256 f, bool stale) = feeHook.feeFor(1 ether);
        assertTrue(stale);
        assertEq(f, 0.001 ether);
        _depositFrom(alice, 1 ether);
    }

    // ======================================================== 8. disabled upstream features

    function test_lpVaultAndRebalanceDisabled() public {
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), 1 ether);
        vm.expectRevert(VmpxCollateralRouter.Disabled.selector);
        lockbox.deposit(1 ether, alice);
        vm.expectRevert(VmpxCollateralRouter.Disabled.selector);
        lockbox.mint(1 ether, alice);
        vm.stopPrank();
        vm.expectRevert(VmpxCollateralRouter.Disabled.selector);
        lockbox.addBridge(X1_DOMAIN, ITokenBridge(address(1)));
        vm.expectRevert(VmpxCollateralRouter.Disabled.selector);
        lockbox.setRecipient(X1_DOMAIN, bytes32(uint256(1)));
    }

    function test_donationDoesNotCreateClaims() public {
        // donate() is upstream & non-overridable; with no LP shares nobody can withdraw it
        _depositFrom(alice, 1_000 ether);
        vm.startPrank(bob);
        vm.expectRevert();
        lockbox.withdraw(1, bob, bob);
        vm.stopPrank();
    }

    // ======================================================== 9. fee governance

    function test_feeCapIsHard() public {
        VmpxEthFeeHook.FeeParams memory p = VmpxEthFeeHook.FeeParams(301, 0, 0.01 ether, 0, 1 days);
        vm.expectRevert(VmpxEthFeeHook.InvalidParams.selector);
        feeHook.announceParams(p);
        p = VmpxEthFeeHook.FeeParams(100, 0, 1 ether, 0, 1 days); // above MAX_FEE_CAP_WEI
        vm.expectRevert(VmpxEthFeeHook.InvalidParams.selector);
        feeHook.announceParams(p);
    }

    function test_feeChangeNeedsDelay() public {
        VmpxEthFeeHook.FeeParams memory p = VmpxEthFeeHook.FeeParams(100, 0.0001 ether, 0.01 ether, 0.0005 ether, 1 days);
        feeHook.announceParams(p);
        vm.expectRevert(VmpxEthFeeHook.NotReady.selector);
        feeHook.executeParams();
        vm.warp(block.timestamp + 3 days);
        feeHook.executeParams();
        (uint16 bps, , , , ) = feeHook.params();
        assertEq(bps, 100);
    }

    function test_nonOwnerCannotAnnounce() public {
        VmpxEthFeeHook.FeeParams memory p = VmpxEthFeeHook.FeeParams(0, 0, 0, 0, 1 days);
        vm.prank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        feeHook.announceParams(p);
    }

    function test_priceUpdateBounded() public {
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        vm.expectRevert(VmpxEthFeeHook.NotPriceUpdater.selector);
        feeHook.updatePrice(PRICE);
        vm.startPrank(priceBot);
        vm.expectRevert(abi.encodeWithSelector(VmpxEthFeeHook.PriceChangeTooLarge.selector, PRICE, PRICE * 2));
        feeHook.updatePrice(PRICE * 2); // flash-pump style jump rejected
        feeHook.updatePrice((PRICE * 12) / 10);
        vm.expectRevert(VmpxEthFeeHook.PriceUpdateTooSoon.selector);
        feeHook.updatePrice((PRICE * 13) / 10);
        vm.stopPrank();
    }

    function test_priceResetDelayed() public {
        feeHook.announcePriceReset(PRICE * 10);
        vm.expectRevert(VmpxEthFeeHook.NotReady.selector);
        feeHook.executePriceReset();
        vm.warp(block.timestamp + 3 days);
        feeHook.executePriceReset();
        assertEq(feeHook.refPriceWeiPerToken(), PRICE * 10);
    }

    function test_feesGoOnlyToBeneficiary() public {
        _depositFrom(alice, 1_000_000 ether);
        uint256 bal = address(feeHook).balance;
        assertGt(bal, 0);
        vm.prank(bob); // anyone can trigger, funds go to treasury
        feeHook.withdrawFees();
        assertEq(treasury.balance, bal);
        assertEq(vmpx.balanceOf(treasury), 0, "fees never touch collateral");
    }
}

