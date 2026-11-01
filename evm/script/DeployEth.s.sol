// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {StaticMessageIdMultisigIsmFactory} from "@hyperlane-xyz/core/contracts/isms/multisig/StaticMultisigIsm.sol";
import {StaticAggregationIsmFactory} from "@hyperlane-xyz/core/contracts/isms/aggregation/StaticAggregationIsmFactory.sol";
import {StaticAggregationHookFactory} from "@hyperlane-xyz/core/contracts/hooks/aggregation/StaticAggregationHookFactory.sol";
import {PausableIsm} from "@hyperlane-xyz/core/contracts/isms/PausableIsm.sol";
import {PausableHook} from "@hyperlane-xyz/core/contracts/hooks/PausableHook.sol";
import {RateLimitedIsm} from "@hyperlane-xyz/core/contracts/isms/warp-route/RateLimitedIsm.sol";
import {IMailbox} from "@hyperlane-xyz/core/contracts/interfaces/IMailbox.sol";
import {VmpxCollateralRouter} from "../src/VmpxCollateralRouter.sol";
import {VmpxEthFeeHook} from "../src/VmpxEthFeeHook.sol";
import {EmergencyPauser} from "../src/EmergencyPauser.sol";

/**
 * Ethereum-side deployment. TESTNET BY DEFAULT: refuses chainid 1 unless ALLOW_MAINNET=true.
 *
 *   forge script script/DeployEth.s.sol --rpc-url $SEPOLIA_RPC --account deployer --broadcast
 *
 * Roles:
 *   SAFE      admin multisig -> proposer/executor of the TimelockController (slow path: config + upgrades)
 *   GUARDIAN  multisig -> controls EmergencyPauser (unpause, pauser list) + CANCELLER on timelock
 *   PAUSERS   single keys (csv, optional) -> EmergencyPauser.pauseAll(): instant stop of deposits AND unlocks
 *   PRICE_BOT hot key, can only move the fee reference price within on-chain bounds
 *   BENEFICIARY receives the fixed ETH fee of the hook (relaying costs)
 *   TREASURY  receives the VMPX bridge fee taken by the router (LP treasury); must differ from BENEFICIARY
 *
 * Fee model v2 (docs/14): the hook charges a FIXED 0.0002 ETH per transfer (feeBps 0, min = max = stale), so the
 * price feed no longer affects the fee; the 3% VMPX fee is taken by the router (setBridgeFee) and sent to TREASURY.
 *
 * Env: TOKEN, MAILBOX, MERKLE_HOOK (the mailbox's MerkleTreeHook — REQUIRED), X1_DOMAIN, X1_VALIDATORS (csv),
 *   X1_THRESHOLD, RATE_CAP (18-dec, multiple of 86400), SAFE, GUARDIAN, PRICE_BOT, BENEFICIARY,
 *   INITIAL_PRICE_WEI, TREASURY, BRIDGE_FEE_BPS (default 300), TIMELOCK_DELAY (default 48h; >=48h enforced on mainnet),
 *   MSIG_FACTORY / AGG_FACTORY / AGG_HOOK_FACTORY (existing Hyperlane factories; unset -> deploy new),
 *   X1_ROUTER_B32 (optional; otherwise enroll later through the timelock),
 *   MAX_LOCKED (router v3 TVL cap, 18-dec; counts only what stays locked, fee excluded). Mainnet: REQUIRED and
 *     <= 1,000,000 VMPX unless ALLOW_LARGE_MAX_LOCKED=true (planned start: 700000000000000000000000 = 700,000 VMPX).
 *     Testnet: unset -> 5,000,000 VMPX (5000000000000000000000000). 0 is rejected (it would close deposits).
 */
contract DeployEth is Script {
    uint256 public constant MAINNET_VALIDATORS = 7;
    uint256 public constant MAINNET_THRESHOLD = 5;
    uint256 public constant FIXED_ETH_FEE = 0.0002 ether; // fee model v2: flat hook fee
    uint256 public constant DEFAULT_BRIDGE_FEE_BPS = 300; // fee model v2: 3% in VMPX, taken by the router
    uint256 public constant MAINNET_MAX_LOCKED_BOUND = 1_000_000 ether; // router v3: sanity bound of the TVL cap
    uint256 public constant TESTNET_DEFAULT_MAX_LOCKED = 5_000_000 ether; // router v3: testnet cap when MAX_LOCKED unset

    struct Config {
        address token;
        address mailbox;
        address merkle;
        uint32 x1Domain;
        address[] validators;
        uint256 threshold;
        address safe;
        address guardian;
        address priceBot;
        address beneficiary;
        address treasury; // VMPX bridge fee recipient (router), separate from the hook beneficiary
        uint256 bridgeFeeBps;
        uint256 maxLocked; // router v3 TVL cap (18-dec); 0 = deposits closed (rejected here)
        uint256 rateCap;
        uint256 timelockDelay;
        uint256 initialPriceWei;
        address msigFactory;
        address aggFactory;
        address aggHookFactory;
        bytes32 x1RouterB32;
        address[] pausers; // single keys allowed to pauseAll (on-call ops, monitor bot)
    }

    struct Out {
        address deployer;
        address router;
        address impl;
        address proxyAdmin;
        address timelock;
        address feeHook;
        address pauseHook;
        address hook;
        address ism;
        address msig;
        address pauseIsm;
        address rateIsm;
        address pauser;
    }

    function run() external returns (Out memory) {
        Config memory c;
        c.token = vm.envAddress("TOKEN");
        c.mailbox = vm.envAddress("MAILBOX");
        c.merkle = vm.envAddress("MERKLE_HOOK");
        c.x1Domain = uint32(vm.envUint("X1_DOMAIN"));
        c.validators = vm.envAddress("X1_VALIDATORS", ",");
        c.threshold = vm.envUint("X1_THRESHOLD");
        c.safe = vm.envAddress("SAFE");
        c.guardian = vm.envAddress("GUARDIAN");
        c.priceBot = vm.envAddress("PRICE_BOT");
        c.beneficiary = vm.envAddress("BENEFICIARY");
        c.treasury = vm.envAddress("TREASURY");
        c.bridgeFeeBps = vm.envOr("BRIDGE_FEE_BPS", DEFAULT_BRIDGE_FEE_BPS);
        c.maxLocked = _maxLockedFromEnv();
        c.rateCap = vm.envUint("RATE_CAP");
        c.timelockDelay = vm.envOr("TIMELOCK_DELAY", uint256(48 hours));
        c.initialPriceWei = vm.envUint("INITIAL_PRICE_WEI");
        c.msigFactory = vm.envOr("MSIG_FACTORY", address(0));
        c.aggFactory = vm.envOr("AGG_FACTORY", address(0));
        c.aggHookFactory = vm.envOr("AGG_HOOK_FACTORY", address(0));
        c.x1RouterB32 = vm.envOr("X1_ROUTER_B32", bytes32(0));
        c.pausers = vm.envOr("PAUSERS", ",", new address[](0));
        return deploy(c);
    }

    function deploy(Config memory c) public returns (Out memory o) {
        bool mainnet = block.chainid == 1;
        if (mainnet) require(vm.envOr("ALLOW_MAINNET", false), "mainnet needs ALLOW_MAINNET=true + explicit approval");
        address token = c.token;
        address mailbox = c.mailbox;
        address merkle = c.merkle;
        uint32 x1Domain = c.x1Domain;
        address[] memory vals = _sortedUnique(c.validators);
        uint256 thr = c.threshold;
        address safe = c.safe;
        address guardian = c.guardian;
        address priceBot = c.priceBot;
        address beneficiary = c.beneficiary;
        uint256 rateCap = c.rateCap;
        uint256 delay = c.timelockDelay;

        // ---- configuration sanity (L-4)
        require(token.code.length > 0 && mailbox.code.length > 0 && merkle.code.length > 0, "token/mailbox/merkle not contracts");
        require(safe != address(0) && guardian != address(0) && beneficiary != address(0) && priceBot != address(0), "zero role");
        require(safe != guardian, "admin and guardian must differ");
        // fee model v2 (Codex round 3, sec. 4): VMPX treasury configured on its own, never assumed to be the hook beneficiary
        require(c.treasury != address(0), "TREASURY=0");
        require(c.treasury != beneficiary, "treasury must differ from hook beneficiary");
        if (mainnet) require(c.bridgeFeeBps == DEFAULT_BRIDGE_FEE_BPS, "mainnet profile: 3% bridge fee");
        // router v3 TVL cap: never 0 (closed) at deploy; on mainnet a sane explicit value, override only on purpose
        require(c.maxLocked > 0, "MAX_LOCKED=0 closes deposits");
        if (mainnet)
            require(
                c.maxLocked <= MAINNET_MAX_LOCKED_BOUND || vm.envOr("ALLOW_LARGE_MAX_LOCKED", false),
                "mainnet profile: MAX_LOCKED <= 1,000,000 VMPX (ALLOW_LARGE_MAX_LOCKED=true to override)"
            );
        require(thr > 0 && thr <= vals.length && thr * 10 >= vals.length * 6, "threshold must be >=60% of set");
        require(vals.length <= type(uint8).max, "too many validators"); // threshold is passed to the factory as uint8
        // mainnet security profile (owner decision 31 Oct 2026, Codex L-03): exactly 5-of-7 X1 attestors
        if (mainnet) require(vals.length == MAINNET_VALIDATORS && thr == MAINNET_THRESHOLD, "mainnet profile: 5-of-7 validators");
        require(c.initialPriceWei > 0, "INITIAL_PRICE_WEI=0"); // Codex L-02
        require(rateCap > 0 && rateCap % 1 days == 0, "RATE_CAP must be a multiple of 86400");
        if (mainnet) require(delay >= 48 hours, "mainnet timelock >= 48h");
        require(IMailbox(mailbox).localDomain() != x1Domain, "domain clash");

        vm.startBroadcast();
        (, address deployer, ) = vm.readCallers();
        o.deployer = deployer;

        // ---- 1. timelock first, so every owner can be set directly (L-3); guardian = canceller (M-4)
        o.timelock = _timelock(delay, safe, guardian, deployer);

        // ---- 2. lockbox implementation + proxy (owner = deployer until wiring is done)
        VmpxCollateralRouter impl = new VmpxCollateralRouter(token, mailbox, 1e9);
        ProxyAdmin pa = new ProxyAdmin();
        VmpxCollateralRouter router = VmpxCollateralRouter(
            address(new TransparentUpgradeableProxy(address(impl), address(pa), abi.encodeCall(impl.initialize, (address(0), address(0), deployer))))
        );
        o.router = address(router);
        o.impl = address(impl);
        o.proxyAdmin = address(pa);

        // ---- 3. ISM: multisig(X1 attestors) AND pausable AND rate-limited
        {
            address msf = c.msigFactory;
            address agf = c.aggFactory;
            if (msf == address(0)) msf = address(new StaticMessageIdMultisigIsmFactory());
            if (agf == address(0)) agf = address(new StaticAggregationIsmFactory());
            o.msig = StaticMessageIdMultisigIsmFactory(msf).deploy(vals, uint8(thr));
            o.pauseIsm = address(new PausableIsm(deployer)); // handed to EmergencyPauser below
            RateLimitedIsm rate = new RateLimitedIsm(mailbox, rateCap, 1 days, address(router));
            require(rate.maxCapacity() == rateCap, "rate cap truncated");
            rate.transferOwnership(o.timelock);
            o.rateIsm = address(rate);
            address[] memory mods = new address[](3);
            mods[0] = o.msig;
            mods[1] = o.pauseIsm;
            mods[2] = o.rateIsm;
            o.ism = StaticAggregationIsmFactory(agf).deploy(mods, 3);
            router.setInterchainSecurityModule(o.ism);
        }

        // ---- 4. hooks: pause -> MERKLE TREE (H-1) -> fee
        {
            VmpxEthFeeHook fh = new VmpxEthFeeHook(
                address(router), router.localDomain(), x1Domain,
                300, 0.05 ether, 3 days, 2_000, 5_000, 1 hours,
                VmpxEthFeeHook.FeeParams({feeBps: 0, minFeeWei: FIXED_ETH_FEE, maxFeeWei: FIXED_ETH_FEE, staleFallbackFeeWei: FIXED_ETH_FEE, maxPriceAge: 2 days}),
                c.initialPriceWei, priceBot, payable(beneficiary), o.timelock
            );
            PausableHook ph = new PausableHook(); // handed to EmergencyPauser below
            address[] memory hs = new address[](3);
            hs[0] = address(ph);
            hs[1] = merkle;
            hs[2] = address(fh);
            address ahf = c.aggHookFactory;
            if (ahf == address(0)) ahf = address(new StaticAggregationHookFactory());
            o.hook = StaticAggregationHookFactory(ahf).deploy(hs);
            router.setHook(o.hook);
            o.feeHook = address(fh);
            o.pauseHook = address(ph);
        }

        // ---- 4b. emergency pauser: any pauser stops both directions, only guardian restarts
        o.pauser = address(new EmergencyPauser(guardian, o.pauseHook, o.pauseIsm, c.pausers));
        PausableHook(o.pauseHook).transferOwnership(o.pauser);
        PausableIsm(o.pauseIsm).transferOwnership(o.pauser);

        // ---- 5. optional enrollment, then hand over
        bytes32 x1Router = c.x1RouterB32;
        if (x1Router != bytes32(0)) router.enrollRemoteRouter(x1Domain, x1Router);
        router.setBridgeFee(c.bridgeFeeBps, c.treasury); // while the deployer still owns the router
        router.initializeV3(c.maxLocked); // onlyOwner: cannot be front-run between proxy creation and this call
        router.transferOwnership(o.timelock);
        pa.transferOwnership(o.timelock);
        vm.stopBroadcast();
        check(c, o);

        console2.log("router(proxy)", o.router);
        console2.log("routerImpl", o.impl);
        console2.log("proxyAdmin", o.proxyAdmin);
        console2.log("timelock", o.timelock);
        console2.log("aggregationHook", o.hook);
        console2.log("pausableHook(deposits)", o.pauseHook);
        console2.log("feeHook", o.feeHook);
        console2.log("ism(aggregation)", o.ism);
        console2.log("multisigIsm", o.msig);
        console2.log("pausableIsm(unlocks)", o.pauseIsm);
        console2.log("rateLimitedIsm", o.rateIsm);
        console2.log("emergencyPauser", o.pauser);
        console2.log("bridgeFeeBps", c.bridgeFeeBps);
        console2.log("treasury", c.treasury);
        console2.log("maxLocked", c.maxLocked);
    }

    /// Post-deploy state check (Codex round 3, sec. 4.7-4.8). A broadcast is a series of transactions, not one atomic
    /// step: after an interrupted run, re-run only this check against the addresses printed so far (verifyDeployment())
    /// and finish the missing steps by hand before announcing anything. Reverts on the first deviation.
    function check(Config memory c, Out memory o) public view {
        VmpxCollateralRouter r = VmpxCollateralRouter(o.router);
        TimelockController tl = TimelockController(payable(o.timelock));
        require(r.owner() == o.timelock, "check: router owner != timelock");
        require(ProxyAdmin(o.proxyAdmin).owner() == o.timelock, "check: proxyAdmin owner != timelock");
        require(VmpxEthFeeHook(payable(o.feeHook)).owner() == o.timelock, "check: fee hook owner != timelock");
        require(RateLimitedIsm(o.rateIsm).owner() == o.timelock, "check: rate ISM owner != timelock");
        require(PausableIsm(o.pauseIsm).owner() == o.pauser && PausableHook(o.pauseHook).owner() == o.pauser, "check: pausables owner != pauser");
        require(address(r.interchainSecurityModule()) == o.ism && address(r.hook()) == o.hook, "check: router ISM/hook");
        require(r.bridgeFeeBps() == c.bridgeFeeBps && r.treasury() == c.treasury, "check: bridge fee/treasury");
        require(r.maxLocked() == c.maxLocked, "check: maxLocked");
        (uint16 bps, uint256 mn, uint256 mx, uint256 st, ) = VmpxEthFeeHook(payable(o.feeHook)).params();
        require(bps == 0 && mn == FIXED_ETH_FEE && mx == FIXED_ETH_FEE && st == FIXED_ETH_FEE, "check: hook fee not fixed 0.0002 ETH");
        require(VmpxEthFeeHook(payable(o.feeHook)).beneficiary() == c.beneficiary, "check: hook beneficiary");
        require(tl.getMinDelay() == c.timelockDelay, "check: timelock delay");
        require(tl.hasRole(tl.PROPOSER_ROLE(), c.safe) && tl.hasRole(tl.EXECUTOR_ROLE(), c.safe), "check: safe roles");
        require(tl.hasRole(tl.CANCELLER_ROLE(), c.guardian), "check: guardian canceller");
        require(tl.hasRole(tl.TIMELOCK_ADMIN_ROLE(), o.timelock), "check: timelock self-admin");
        bytes32[4] memory roles = [tl.PROPOSER_ROLE(), tl.EXECUTOR_ROLE(), tl.CANCELLER_ROLE(), tl.TIMELOCK_ADMIN_ROLE()];
        for (uint256 i; i < 4; i++) require(!tl.hasRole(roles[i], o.deployer), "check: deployer still has a timelock role");
        require(EmergencyPauser(o.pauser).guardian() == c.guardian, "check: pauser guardian");
    }

    /// forge script script/DeployEth.s.sol --sig "verifyDeployment()" --rpc-url ...  (same env as run() plus the
    /// addresses printed by the deploy: ROUTER, PROXY_ADMIN, TIMELOCK, FEE_HOOK, PAUSE_HOOK, AGG_HOOK, AGG_ISM,
    /// PAUSE_ISM, RATE_ISM, PAUSER, DEPLOYER)
    function verifyDeployment() external view {
        Config memory c;
        c.safe = vm.envAddress("SAFE");
        c.guardian = vm.envAddress("GUARDIAN");
        c.beneficiary = vm.envAddress("BENEFICIARY");
        c.treasury = vm.envAddress("TREASURY");
        c.bridgeFeeBps = vm.envOr("BRIDGE_FEE_BPS", DEFAULT_BRIDGE_FEE_BPS);
        c.maxLocked = _maxLockedFromEnv();
        c.timelockDelay = vm.envOr("TIMELOCK_DELAY", uint256(48 hours));
        Out memory o;
        o.router = vm.envAddress("ROUTER");
        o.proxyAdmin = vm.envAddress("PROXY_ADMIN");
        o.timelock = vm.envAddress("TIMELOCK");
        o.feeHook = vm.envAddress("FEE_HOOK");
        o.pauseHook = vm.envAddress("PAUSE_HOOK");
        o.hook = vm.envAddress("AGG_HOOK");
        o.ism = vm.envAddress("AGG_ISM");
        o.pauseIsm = vm.envAddress("PAUSE_ISM");
        o.rateIsm = vm.envAddress("RATE_ISM");
        o.pauser = vm.envAddress("PAUSER");
        o.deployer = vm.envAddress("DEPLOYER");
        check(c, o);
        console2.log("deployment check: OK");
    }

    /// MAX_LOCKED: required on mainnet (no default there); testnet falls back to TESTNET_DEFAULT_MAX_LOCKED
    function _maxLockedFromEnv() internal view returns (uint256) {
        string memory raw = vm.envOr("MAX_LOCKED", string(""));
        if (bytes(raw).length == 0) {
            require(block.chainid != 1, "mainnet: MAX_LOCKED must be set explicitly");
            return TESTNET_DEFAULT_MAX_LOCKED;
        }
        return vm.parseUint(raw);
    }

    function _timelock(uint256 delay, address safe, address guardian, address tmpAdmin) internal returns (address) {
        address[] memory admins = new address[](1);
        admins[0] = safe;
        TimelockController tl = new TimelockController(delay, admins, admins, tmpAdmin);
        tl.grantRole(tl.CANCELLER_ROLE(), guardian);
        tl.renounceRole(tl.TIMELOCK_ADMIN_ROLE(), tmpAdmin); // timelock now self-administered
        return address(tl);
    }

    function _sortedUnique(address[] memory a) internal pure returns (address[] memory) {
        for (uint256 i = 1; i < a.length; i++) {
            address k = a[i];
            uint256 j = i;
            while (j > 0 && a[j - 1] > k) {
                a[j] = a[j - 1];
                j--;
            }
            a[j] = k;
        }
        for (uint256 i = 1; i < a.length; i++) require(a[i] != a[i - 1], "duplicate validator");
        for (uint256 i; i < a.length; i++) require(a[i] != address(0), "zero validator");
        return a;
    }
}
