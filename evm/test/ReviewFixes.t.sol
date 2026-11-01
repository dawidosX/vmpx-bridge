// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {BridgeBase, MockVMPX} from "./BridgeBase.t.sol";
import {Test, Vm} from "forge-std/Test.sol";
import {TypeCasts} from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";
import {Mailbox} from "@hyperlane-xyz/core/contracts/Mailbox.sol";
import {MerkleTreeHook} from "@hyperlane-xyz/core/contracts/hooks/MerkleTreeHook.sol";
import {ProtocolFee} from "@hyperlane-xyz/core/contracts/hooks/ProtocolFee.sol";
import {NoopIsm} from "@hyperlane-xyz/core/contracts/isms/NoopIsm.sol";
import {Quote, ITokenFee} from "@hyperlane-xyz/core/contracts/interfaces/ITokenBridge.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {VmpxCollateralRouter} from "../src/VmpxCollateralRouter.sol";
import {VmpxEthFeeHook} from "../src/VmpxEthFeeHook.sol";
import {DeployEth} from "../script/DeployEth.s.sol";
import {EmergencyPauser} from "../src/EmergencyPauser.sol";

contract GreedyFee is ITokenFee {
    address immutable tok;

    constructor(address t) {
        tok = t;
    }

    function quoteTransferRemote(uint32, bytes32, uint256) external view returns (Quote[] memory q) {
        q = new Quote[](1);
        q[0] = Quote(tok, 500_000 ether);
    }
}

/// Regression tests for the independent review (docs/12-review-findings.md).
contract ReviewFixesTest is BridgeBase {
    using TypeCasts for address;

    // H-1: deposits must be inserted into the mailbox merkle tree, otherwise never attestable
    function test_H1_depositIsInsertedIntoMerkleTree() public {
        assertEq(ethMerkle.count(), 0);
        _depositFrom(alice, 1_000 ether);
        assertEq(ethMerkle.count(), 1, "deposit must be attestable by validators");
    }

    // M-2: an unlock larger than the bucket is stuck — recovery path: timelock raises capacity
    function test_M2_oversizedUnlockRecoverable() public {
        uint256 big = RATE_CAP * 2;
        vmpx.mintTo(alice, big);
        _depositFrom(alice, big);
        _deliverToX1();
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), big / 1e9);
        uint32 n = ethMb.inboundProcessedNonce();
        ethMb.addInboundMetadata(n, _aggMeta(_signMsgId(ethMb.inboundMessages(n), _keys(x1ValKeys[0], x1ValKeys[1]))));
        vm.expectRevert("RateLimitExceeded");
        ethMb.processNextInboundMessage();
        rateIsm.setRefillRate(big); // owner = timelock in production (48h)
        vm.warp(block.timestamp + 1 days);
        ethMb.processNextInboundMessage();
        assertEq(vmpx.balanceOf(alice), 1_000_000 ether + big);
        _assertCollateralInvariant();
    }

    // Codex round 3, R-08: one timelock batch raises the limit, delivers the one stuck message and restores C, so the
    // raised limit never stays in force (the old runbook kept it for another timelock delay). If process() fails
    // (pause, bad metadata, gas) the whole batch reverts and the limit is never raised.
    function _oversizedStuck() internal returns (uint256 big, bytes memory meta, bytes memory message) {
        big = RATE_CAP * 2;
        vmpx.mintTo(alice, big);
        _depositFrom(alice, big);
        _deliverToX1();
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), big / 1e9);
        uint32 n = ethMb.inboundProcessedNonce();
        message = ethMb.inboundMessages(n);
        meta = _aggMeta(_signMsgId(message, _keys(x1ValKeys[0], x1ValKeys[1])));
        vm.expectRevert("RateLimitExceeded");
        ethMb.process(meta, message);
        rateIsm.transferOwnership(address(timelock));
    }

    function _batch(uint256 big, bytes memory meta, bytes memory message)
        internal view returns (address[] memory t, uint256[] memory v, bytes[] memory d)
    {
        t = new address[](3); v = new uint256[](3); d = new bytes[](3);
        t[0] = address(rateIsm); d[0] = abi.encodeWithSignature("setRefillRate(uint256)", big);
        t[1] = address(ethMb);   d[1] = abi.encodeWithSignature("process(bytes,bytes)", meta, message);
        t[2] = address(rateIsm); d[2] = abi.encodeWithSignature("setRefillRate(uint256)", RATE_CAP);
    }

    function test_R08_atomicRaiseDeliverRestore() public {
        (uint256 big, bytes memory meta, bytes memory message) = _oversizedStuck();
        (address[] memory t, uint256[] memory v, bytes[] memory d) = _batch(big, meta, message);
        timelock.scheduleBatch(t, v, d, bytes32(0), bytes32("r08"), TIMELOCK_DELAY);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        uint256 before = vmpx.balanceOf(alice);
        timelock.executeBatch(t, v, d, bytes32(0), bytes32("r08"));
        assertEq(vmpx.balanceOf(alice) - before, big, "stuck message delivered");
        assertEq(rateIsm.maxCapacity(), RATE_CAP, "capacity back to C in the same transaction");
        assertLe(rateIsm.calculateCurrentLevel(), RATE_CAP, "level within C");
        // processed with Mailbox.process() directly, outside the mock's inbound queue: check the backing directly
        assertEq(vmpx.balanceOf(address(lockbox)), synth.totalSupply() * 1e9, "lockbox == X1 supply");
    }

    function test_R08_batchRevertsWholeWhenProcessFails() public {
        (uint256 big, bytes memory meta, bytes memory message) = _oversizedStuck();
        (address[] memory t, uint256[] memory v, bytes[] memory d) = _batch(big, meta, message);
        timelock.scheduleBatch(t, v, d, bytes32(0), bytes32("r08"), TIMELOCK_DELAY);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.prank(guardian);
        pauseIsm.pause();                                   // e.g. paused again during the delay
        vm.expectRevert();
        timelock.executeBatch(t, v, d, bytes32(0), bytes32("r08"));
        assertEq(rateIsm.maxCapacity(), RATE_CAP, "limit never raised");
    }

    // L-2: exactly RATE_CAP is deliverable (cap is a multiple of 86400)
    function test_L2_exactCapDeliverable() public {
        assertEq(rateIsm.maxCapacity(), RATE_CAP);
        vmpx.mintTo(alice, RATE_CAP);
        _depositFrom(alice, RATE_CAP);
        _deliverToX1();
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), RATE_CAP / 1e9);
        _deliverToEth();
        _assertCollateralInvariant();
    }

    // L-1: token-denominated fee paths cannot pull extra VMPX
    function test_L1_feeRecipientHasNoEffect() public {
        lockbox.setFeeRecipient(address(new GreedyFee(address(vmpx))));
        vm.prank(alice);
        vmpx.approve(address(lockbox), type(uint256).max); // worst case: standing max approval
        uint256 before = vmpx.balanceOf(alice);
        uint256 fee = _quoteEthToX1(1_000 ether);
        vm.prank(alice);
        lockbox.transferRemote{value: fee}(X1_DOMAIN, alice.addressToBytes32(), 1_000 ether);
        assertEq(before - vmpx.balanceOf(alice), 1_000 ether, "only the bridged amount is pulled");
        assertEq(lockbox.feeRecipient(), address(0));
    }

    function test_L1_tokenFeeHookBlocksInsteadOfCharging() public {
        lockbox.setFeeHook(address(feeHook));
        vm.startPrank(alice);
        vmpx.approve(address(lockbox), type(uint256).max);
        uint256 before = vmpx.balanceOf(alice);
        vm.expectRevert(VmpxCollateralRouter.TokenFeeHookNotAllowed.selector);
        lockbox.transferRemote{value: 1 ether}(X1_DOMAIN, alice.addressToBytes32(), 1_000 ether);
        vm.stopPrank();
        assertEq(vmpx.balanceOf(alice), before);
    }

    // L-5: announced changes: owner-only execute, cancellable, expire
    function test_L5_priceResetCancelExpireOwnerOnly() public {
        feeHook.announcePriceReset(PRICE * 10);
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        vm.expectRevert("Ownable: caller is not the owner");
        feeHook.executePriceReset();
        feeHook.cancelPriceReset();
        vm.expectRevert(VmpxEthFeeHook.NotReady.selector);
        feeHook.executePriceReset();

        feeHook.announcePriceReset(PRICE * 10);
        vm.warp(block.timestamp + 3 days + 7 days + 1);
        vm.expectRevert(VmpxEthFeeHook.Expired.selector);
        feeHook.executePriceReset();
    }

    function test_L5_paramsExpire() public {
        feeHook.announceParams(VmpxEthFeeHook.FeeParams(100, 0, 0.01 ether, 0, 1 days));
        vm.warp(block.timestamp + 11 days);
        vm.expectRevert(VmpxEthFeeHook.Expired.selector);
        feeHook.executeParams();
    }

    // L-6: compromised price bot cannot walk the price far within a day
    function test_L6_cumulativeDailyBound() public {
        uint256 p = PRICE;
        uint256 t = feeHook.priceUpdatedAt();
        vm.startPrank(priceBot);
        vm.warp(t + 1 hours);
        p = (p * 12) / 10;
        feeHook.updatePrice(p); // +20%
        vm.warp(t + 2 hours);
        p = (p * 12) / 10;
        feeHook.updatePrice(p); // +44% cumulative
        vm.warp(t + 3 hours);
        uint256 next = (p * 12) / 10; // +72.8% cumulative > 50%
        vm.expectRevert(abi.encodeWithSelector(VmpxEthFeeHook.PriceChangeTooLarge.selector, PRICE, next));
        feeHook.updatePrice(next);
        vm.warp(t + 1 hours + 1 days); // new window anchored at the current price
        feeHook.updatePrice(next);
        vm.stopPrank();
    }

    // direct postDispatch with a foreign message reverts
    function test_postDispatchForeignReverts() public {
        bytes memory body = abi.encodePacked(alice.addressToBytes32(), uint256(1 ether));
        bytes memory m = ethMb.buildMessage(address(0xdead), X1_DOMAIN, alice.addressToBytes32(), body);
        vm.expectRevert(abi.encodeWithSelector(VmpxEthFeeHook.WrongSender.selector, address(0xdead)));
        feeHook.postDispatch{value: 1 ether}("", m);
    }

    // Codex I-01: upstream donate() (public payable, not virtual) cannot be disabled; a donation is surplus only:
    // no shares, no claim, solvency (lockbox >= liabilities) holds. ETH sent along stays in the router.
    function test_I1_donateIsSurplusOnly() public {
        _depositFrom(alice, 100 ether);
        vmpx.mintTo(bob, 10 ether);
        vm.startPrank(bob);
        vmpx.approve(address(lockbox), 10 ether);
        lockbox.donate{value: 1 ether}(10 ether);
        vm.stopPrank();
        donated += 10 ether;
        assertEq(lockbox.totalSupply(), 0, "no shares");
        assertEq(address(lockbox).balance, 1 ether, "ETH sent with donate() is stuck (documented)");
        _assertCollateralInvariant();
        vm.startPrank(bob);
        vm.expectRevert();
        lockbox.redeem(1, bob, bob);
        vm.expectRevert();
        lockbox.withdraw(1, bob, bob);
        vm.stopPrank();
    }

    // Codex I-01: a plain ERC-20 transfer cannot be blocked; it is a surplus, the bridge stays solvent
    function test_I1_directTransferIsSurplusOnly() public {
        _depositFrom(alice, 1_000 ether);
        _deliverToX1();
        vmpx.mintTo(bob, 5 ether);
        vm.prank(bob);
        vmpx.transfer(address(lockbox), 5 ether);
        donated += 5 ether;
        _assertCollateralInvariant(); // locked = supply + 5 surplus
        vm.prank(alice);
        synth.transferRemote(ETH, alice.addressToBytes32(), 1_000e9);
        _deliverToEth();
        assertEq(vmpx.balanceOf(address(lockbox)), 5 ether, "only the surplus is left, nobody can claim it");
        _assertCollateralInvariant();
    }

    // Codex L-02: a zero initial reference price is rejected (no relative update could ever pass from 0)
    function test_L2_zeroInitialPriceRejected() public {
        vm.expectRevert("price=0");
        new VmpxEthFeeHook(
            address(lockbox), ETH, X1_DOMAIN, 300, 0.05 ether, 3 days, 2_000, 5_000, 1 hours,
            VmpxEthFeeHook.FeeParams({feeBps: 300, minFeeWei: 0.0002 ether, maxFeeWei: 0.02 ether, staleFallbackFeeWei: 0.001 ether, maxPriceAge: 2 days}),
            0, priceBot, treasury, address(this)
        );
    }

    // Codex L-01 / review N-4: the daily bound is a FIXED window (documented). Around a window boundary the price can
    // move (1 + 50%)^2 - 1 = +125% within about 6 hours (1.5x before the boundary, 1.5x again after it, 20% steps
    // one hour apart). The fee stays capped by maxFeeWei, and with the fixed fee the price does not affect it at all.
    function test_L1_fixedWindowBoundaryDocumented() public {
        uint256 t = feeHook.windowStart();
        uint256 p = PRICE;
        vm.startPrank(priceBot);
        vm.warp(t + 1 days - 3 hours);
        feeHook.updatePrice((p * 12) / 10);
        vm.warp(t + 1 days - 2 hours);
        feeHook.updatePrice((p * 144) / 100);
        vm.warp(t + 1 days - 1 hours);
        feeHook.updatePrice((p * 150) / 100); // +50%: the window limit
        vm.warp(t + 1 days);
        feeHook.updatePrice((p * 180) / 100); // new window, anchor = 1.5P, +20%
        vm.warp(t + 1 days + 1 hours);
        feeHook.updatePrice((p * 216) / 100); // +44% from the new anchor
        vm.warp(t + 1 days + 2 hours);
        feeHook.updatePrice((p * 225) / 100); // +50% from the new anchor: the new window's limit
        vm.warp(t + 1 days + 3 hours);
        uint256 more = (p * 2475) / 1000;      // +10% more would exceed the new window
        vm.expectRevert(abi.encodeWithSelector(VmpxEthFeeHook.PriceChangeTooLarge.selector, (p * 150) / 100, more));
        feeHook.updatePrice(more);
        vm.stopPrank();
        assertEq(feeHook.refPriceWeiPerToken(), (p * 225) / 100, "+125% within 6 hours around the boundary");
        (uint256 fee, ) = feeHook.feeFor(10_000_000 ether);
        assertLe(fee, 0.02 ether, "fee still capped by maxFeeWei");
    }
}

/// H-1 + L-3 + L-4 + M-4 on a REAL Mailbox topology (requiredHook = ProtocolFee, as on Ethereum mainnet),
/// executing the actual deployment script logic (DeployEth.deploy).
contract DeployScriptTest is Test {
    using TypeCasts for address;

    Mailbox mb;
    MerkleTreeHook merkle;
    MockVMPX vmpx;
    address safe = address(0x5AFE);
    address guardian = address(0x6A2D);

    function setUp() public {
        mb = new Mailbox(1);
        merkle = new MerkleTreeHook(address(mb));
        ProtocolFee pf = new ProtocolFee(1 gwei, 0, address(this), address(this));
        mb.initialize(address(this), address(new NoopIsm()), address(merkle), address(pf));
        vmpx = new MockVMPX();
    }

    function _cfg() internal view returns (DeployEth.Config memory c) {
        address[] memory v = new address[](3);
        v[0] = address(0xa3);
        v[1] = address(0xa1);
        v[2] = address(0xa2);
        c.token = address(vmpx);
        c.mailbox = address(mb);
        c.merkle = address(merkle);
        c.x1Domain = 1479626324;
        c.validators = v;
        c.threshold = 2;
        c.rateCap = 1_036_800 ether;
        c.safe = safe;
        c.guardian = guardian;
        c.priceBot = address(0xB07);
        c.beneficiary = address(0x7EA5);
        c.treasury = address(0x7EA2);
        c.bridgeFeeBps = 300;
        c.maxLocked = 5_000_000 ether; // testnet cap (router v3)
        c.initialPriceWei = 4e11;
        c.timelockDelay = 48 hours;
        c.x1RouterB32 = bytes32(uint256(0x1234));
        c.pausers = new address[](1);
        c.pausers[0] = address(0xB0B0);
    }

    function test_scriptWiringOnRealMailbox() public {
        DeployEth d = new DeployEth();
        DeployEth.Out memory o = d.deploy(_cfg());
        VmpxCollateralRouter r = VmpxCollateralRouter(o.router);
        TimelockController tl = TimelockController(payable(o.timelock));

        assertEq(r.owner(), o.timelock, "router owner");
        assertEq(Ownable(o.proxyAdmin).owner(), o.timelock, "proxyAdmin owner");
        assertEq(VmpxEthFeeHook(payable(o.feeHook)).owner(), o.timelock, "fee hook owner set directly");
        assertEq(Ownable(o.rateIsm).owner(), o.timelock, "rate ism owner");
        assertEq(Ownable(o.pauseIsm).owner(), o.pauser, "pause ism owner");
        assertEq(Ownable(o.pauseHook).owner(), o.pauser, "pause hook owner");
        assertEq(EmergencyPauser(o.pauser).guardian(), guardian);
        assertTrue(EmergencyPauser(o.pauser).isPauser(address(0xB0B0)));
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), safe));
        assertTrue(tl.hasRole(tl.CANCELLER_ROLE(), guardian), "guardian can cancel");
        assertTrue(tl.hasRole(tl.TIMELOCK_ADMIN_ROLE(), address(tl)));
        assertFalse(tl.hasRole(tl.TIMELOCK_ADMIN_ROLE(), o.deployer), "temp admin renounced");
        assertEq(tl.getMinDelay(), 48 hours);
        assertEq(r.routers(1479626324), bytes32(uint256(0x1234)));

        address alice = address(0xA11CE);
        vmpx.mintTo(alice, 1_000 ether);
        vm.deal(alice, 1 ether);
        Quote[] memory q = r.quoteTransferRemote(1479626324, alice.addressToBytes32(), 1_000 ether);
        vm.startPrank(alice);
        vmpx.approve(o.router, 1_000 ether);
        r.transferRemote{value: q[0].amount}(1479626324, alice.addressToBytes32(), 1_000 ether);
        vm.stopPrank();
        assertEq(merkle.count(), 1, "inserted into merkle tree (H-1)");
        assertEq(vmpx.balanceOf(o.router), 970 ether, "lockbox holds the net amount (3% to the treasury)");
        assertEq(o.feeHook.balance, 0.0002 ether, "fixed ETH fee collected");
    }

    function test_singlePauserStopsDepositsAndOnlyGuardianRestarts() public {
        DeployEth.Out memory o = new DeployEth().deploy(_cfg());
        EmergencyPauser ep = EmergencyPauser(o.pauser);
        vm.prank(address(0xBAD));
        vm.expectRevert(EmergencyPauser.NotPauser.selector);
        ep.pauseAll("x");

        vm.prank(address(0xB0B0)); // one on-call key / monitoring bot
        ep.pauseAll("collateral monitor CRITICAL");
        assertTrue(PausableHookLike(o.pauseHook).paused());
        assertTrue(PausableHookLike(o.pauseIsm).paused());
        vm.prank(address(0xB0B0));
        ep.pauseAll("again"); // idempotent

        address alice = address(0xA11CE);
        vmpx.mintTo(alice, 10 ether);
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        vmpx.approve(o.router, 10 ether);
        vm.expectRevert("Pausable: paused");
        VmpxCollateralRouter(o.router).transferRemote{value: 0.1 ether}(1479626324, alice.addressToBytes32(), 10 ether);
        vm.stopPrank();

        vm.prank(address(0xB0B0));
        vm.expectRevert(EmergencyPauser.NotGuardian.selector);
        ep.unpause(true, true);
        vm.prank(guardian);
        ep.unpause(true, true);
        assertFalse(PausableHookLike(o.pauseHook).paused());
        vm.prank(guardian);
        ep.setPauser(address(0xB0B0), false);
        vm.prank(address(0xB0B0));
        vm.expectRevert(EmergencyPauser.NotPauser.selector);
        ep.pauseAll("revoked");
    }

    function test_scriptRejectsDuplicateValidators() public {
        DeployEth.Config memory c = _cfg();
        c.validators[0] = c.validators[1];
        DeployEth d = new DeployEth();
        vm.expectRevert("duplicate validator");
        d.deploy(c);
    }

    function test_scriptRejectsSameAdminAndGuardian() public {
        DeployEth.Config memory c = _cfg();
        c.guardian = safe;
        DeployEth d = new DeployEth();
        vm.expectRevert("admin and guardian must differ");
        d.deploy(c);
    }

    function test_scriptRejectsTruncatingRateCap() public {
        DeployEth.Config memory c = _cfg();
        c.rateCap = 1_000_000 ether;
        DeployEth d = new DeployEth();
        vm.expectRevert("RATE_CAP must be a multiple of 86400");
        d.deploy(c);
    }

    function test_scriptRejectsZeroPrice() public {
        DeployEth.Config memory c = _cfg();
        c.initialPriceWei = 0;
        DeployEth d = new DeployEth();
        vm.expectRevert("INITIAL_PRICE_WEI=0");
        d.deploy(c);
    }

    // Codex L-03: on mainnet only the 5-of-7 profile deploys
    function _mainnet(uint256 n, uint256 thr) internal returns (DeployEth.Config memory c) {
        vm.chainId(1);
        vm.setEnv("ALLOW_MAINNET", "true");
        c = _cfg();
        address[] memory v = new address[](n);
        for (uint256 i; i < n; i++) v[i] = address(uint160(0xa1 + i));
        c.validators = v;
        c.threshold = thr;
        c.maxLocked = 700_000 ether; // planned mainnet start cap (router v3)
    }

    function test_mainnetRejects6of10() public {
        DeployEth.Config memory c = _mainnet(10, 6);
        DeployEth d = new DeployEth();
        vm.expectRevert("mainnet profile: 5-of-7 validators");
        d.deploy(c);
    }

    // Codex round 3, sec. 8: the old name promised 4-of-7 but tested 6-of-7. 4/7 (57%) already fails the generic
    // >=60% rule; 2/3 and 6/7 pass it and are rejected by the mainnet profile.
    function test_mainnetRejects2of3_4of7_6of7() public {
        DeployEth d = new DeployEth();
        DeployEth.Config memory c = _mainnet(3, 2);
        vm.expectRevert("mainnet profile: 5-of-7 validators");
        d.deploy(c);
        c = _mainnet(7, 4);
        vm.expectRevert("threshold must be >=60% of set");
        d.deploy(c);
        c = _mainnet(7, 6);
        vm.expectRevert("mainnet profile: 5-of-7 validators");
        d.deploy(c);
    }

    // ---- fee model v2 on a fresh deployment (Codex round 3, sec. 4)
    bytes32 constant DISPATCH_TOPIC = keccak256("Dispatch(address,uint32,bytes32,bytes)");

    function _send(DeployEth.Out memory o, uint256 amount) internal returns (uint256 msgAmount, uint256 ethFee) {
        address alice = address(0xA11CE);
        vmpx.mintTo(alice, amount);
        vm.deal(alice, 1 ether);
        VmpxCollateralRouter r = VmpxCollateralRouter(o.router);
        Quote[] memory q = r.quoteTransferRemote(1479626324, alice.addressToBytes32(), amount);
        uint256 hookBefore = o.feeHook.balance;
        vm.recordLogs();
        vm.startPrank(alice);
        vmpx.approve(o.router, amount);
        r.transferRemote{value: q[0].amount}(1479626324, alice.addressToBytes32(), amount);
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(mb) && logs[i].topics[0] == DISPATCH_TOPIC) {
                bytes memory m = abi.decode(logs[i].data, (bytes));
                // header 77 bytes, then TokenMessage: recipient (32) | amount (32)
                assembly { msgAmount := mload(add(add(m, 32), 109)) }
            }
        }
        ethFee = o.feeHook.balance - hookBefore;
    }

    function test_v2_freshDeploy_1000_gives_30_970_970() public {
        DeployEth.Out memory o = new DeployEth().deploy(_cfg());
        (uint256 msgAmount, uint256 ethFee) = _send(o, 1_000 ether);
        assertEq(vmpx.balanceOf(address(0x7EA2)), 30 ether, "treasury 3%");
        assertEq(vmpx.balanceOf(o.router), 970 ether, "lockbox net");
        assertEq(msgAmount, 970 ether, "message carries net");
        assertEq(ethFee, 0.0002 ether, "fixed ETH fee");
    }

    function test_v2_fixedEthFee_smallLargeFreshStale() public {
        DeployEth.Out memory o = new DeployEth().deploy(_cfg());
        VmpxEthFeeHook fh = VmpxEthFeeHook(payable(o.feeHook));
        uint256[3] memory amts = [uint256(1e9), 1_000 ether, 1_000_000 ether];
        for (uint256 i; i < 3; i++) {
            (uint256 f, bool stale) = fh.feeFor(amts[i]);
            assertEq(f, 0.0002 ether);
            assertFalse(stale);
        }
        vm.warp(block.timestamp + 3 days); // price older than maxPriceAge (2 days)
        for (uint256 i; i < 3; i++) {
            (uint256 f, bool stale) = fh.feeFor(amts[i]);
            assertEq(f, 0.0002 ether, "stale price: same fee");
            assertTrue(stale);
        }
        (, uint256 ethFee) = _send(o, 5_000_000 ether);
        assertEq(ethFee, 0.0002 ether, "large stale transfer pays the fixed fee");
    }

    function test_v2_treasuryRules() public {
        DeployEth d = new DeployEth();
        DeployEth.Config memory c = _cfg();
        c.treasury = address(0);
        vm.expectRevert("TREASURY=0");
        d.deploy(c);
        c = _cfg();
        c.treasury = c.beneficiary;
        vm.expectRevert("treasury must differ from hook beneficiary");
        d.deploy(c);
        c = _mainnet(7, 5);
        c.bridgeFeeBps = 200;
        vm.expectRevert("mainnet profile: 3% bridge fee");
        d.deploy(c);
    }

    function test_v2_onlyTimelockChangesFeeAfterDeploy() public {
        DeployEth.Out memory o = new DeployEth().deploy(_cfg());
        VmpxCollateralRouter r = VmpxCollateralRouter(o.router);
        assertEq(r.bridgeFeeBps(), 300);
        assertEq(r.treasury(), address(0x7EA2));
        vm.prank(o.deployer);
        vm.expectRevert("Ownable: caller is not the owner");
        r.setBridgeFee(500, o.deployer);
        vm.prank(o.timelock);
        r.setBridgeFee(250, address(0x7EA2));
        assertEq(r.bridgeFeeBps(), 250);
    }

    function test_v2_checkCatchesInterruptedDeploy() public {
        DeployEth d = new DeployEth();
        DeployEth.Config memory c = _cfg();
        DeployEth.Out memory o = d.deploy(c);
        d.check(c, o); // complete deployment passes
        // interrupted before the router handover: owner still the deployer
        vm.prank(o.timelock);
        VmpxCollateralRouter(o.router).transferOwnership(o.deployer);
        vm.expectRevert("check: router owner != timelock");
        d.check(c, o);
        // wrong fee recipient is caught as well
        vm.prank(o.deployer);
        VmpxCollateralRouter(o.router).transferOwnership(o.timelock);
        vm.prank(o.timelock);
        VmpxCollateralRouter(o.router).setBridgeFee(300, address(0xBEEF));
        vm.expectRevert("check: bridge fee/treasury");
        d.check(c, o);
    }

    // ---- router v3 TVL cap (MAX_LOCKED) on a fresh deployment
    function test_v3_freshDeploySetsMaxLocked() public {
        DeployEth.Out memory o = new DeployEth().deploy(_cfg());
        VmpxCollateralRouter r = VmpxCollateralRouter(o.router);
        assertEq(r.maxLocked(), 5_000_000 ether);
        vm.expectRevert("Initializable: contract is already initialized");
        vm.prank(o.timelock);
        r.initializeV3(1);
        vm.prank(o.deployer);
        vm.expectRevert("Ownable: caller is not the owner");
        r.setMaxLocked(type(uint256).max);
        vm.prank(o.timelock);
        r.setMaxLocked(970 ether);
        _send(o, 1_000 ether); // 970 locked == cap
        address alice = address(0xA11CE);
        vmpx.mintTo(alice, 1 ether);
        vm.startPrank(alice);
        vmpx.approve(o.router, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(VmpxCollateralRouter.MaxLockedExceeded.selector, 970.97 ether, 970 ether));
        r.transferRemote{value: 0.0002 ether}(1479626324, alice.addressToBytes32(), 1 ether);
        vm.stopPrank();
    }

    function test_v3_maxLockedRules() public {
        DeployEth d = new DeployEth();
        DeployEth.Config memory c = _cfg();
        c.maxLocked = 0;
        vm.expectRevert("MAX_LOCKED=0 closes deposits");
        d.deploy(c);
        c = _mainnet(7, 5);
        c.maxLocked = 1_000_000 ether + 1;
        vm.expectRevert("mainnet profile: MAX_LOCKED <= 1,000,000 VMPX (ALLOW_LARGE_MAX_LOCKED=true to override)");
        d.deploy(c);
        c = _mainnet(7, 5);
        c.maxLocked = type(uint256).max; // "no cap" is not a mainnet default either
        vm.expectRevert("mainnet profile: MAX_LOCKED <= 1,000,000 VMPX (ALLOW_LARGE_MAX_LOCKED=true to override)");
        d.deploy(c);
        vm.setEnv("ALLOW_LARGE_MAX_LOCKED", "true");
        c = _mainnet(7, 5);
        c.maxLocked = 2_000_000 ether;
        DeployEth.Out memory o = d.deploy(c);
        vm.setEnv("ALLOW_LARGE_MAX_LOCKED", "false");
        assertEq(VmpxCollateralRouter(o.router).maxLocked(), 2_000_000 ether, "explicit override");
        o = d.deploy(_mainnet(7, 5));
        assertEq(VmpxCollateralRouter(o.router).maxLocked(), 700_000 ether, "planned mainnet start");
    }

    function test_v3_checkCatchesWrongMaxLocked() public {
        DeployEth d = new DeployEth();
        DeployEth.Config memory c = _cfg();
        DeployEth.Out memory o = d.deploy(c);
        d.check(c, o);
        vm.prank(o.timelock);
        VmpxCollateralRouter(o.router).setMaxLocked(type(uint256).max);
        vm.expectRevert("check: maxLocked");
        d.check(c, o);
    }

    function test_mainnetAccepts5of7() public {
        DeployEth.Out memory o = new DeployEth().deploy(_mainnet(7, 5));
        assertTrue(o.msig != address(0));
        (, uint8 thr) = StaticThresholdLike(o.msig).validatorsAndThreshold("");
        assertEq(thr, 5);
    }

    function test_scriptRejectsLowThreshold() public {
        DeployEth.Config memory c = _cfg();
        c.threshold = 1;
        DeployEth d = new DeployEth();
        vm.expectRevert("threshold must be >=60% of set");
        d.deploy(c);
    }
}

interface StaticThresholdLike {
    function validatorsAndThreshold(bytes calldata) external view returns (address[] memory, uint8);
}

interface PausableHookLike {
    function paused() external view returns (bool);
}
