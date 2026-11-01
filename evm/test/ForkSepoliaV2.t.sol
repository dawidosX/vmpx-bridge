// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Quote} from "@hyperlane-xyz/core/contracts/interfaces/ITokenBridge.sol";
import {VmpxCollateralRouter} from "../src/VmpxCollateralRouter.sol";
import {VmpxEthFeeHook} from "../src/VmpxEthFeeHook.sol";

/// Dry run of the Sepolia rollout on a local fork (nothing is sent): the exact Timelock batch
/// (upgrade + setBridgeFee + initializeV3 for the router v3 TVL cap) and the fee-hook change, then a real deposit through the live hook stack.
/// Run: SEPOLIA_FORK_RPC=https://ethereum-sepolia.publicnode.com forge test --evm-version cancun --match-path test/ForkSepoliaV2.t.sol
/// (cancun: some live Sepolia contracts use PUSH0; without the env var both tests are no-ops)
contract ForkSepoliaV2Test is Test {
    VmpxCollateralRouter constant R = VmpxCollateralRouter(0x048C8208B0B37157FBbD71a737a34B1C5A00f6C8);
    ProxyAdmin constant PA = ProxyAdmin(0x502bf50963a67f4d090333210ae85b11aB7f9816);
    TimelockController constant TL = TimelockController(payable(0x0665DEe31B1288EBD72F0Cd908B6b66F77AF7F8E));
    VmpxEthFeeHook constant FH = VmpxEthFeeHook(payable(0x72BCD91Fc700D665e0E681FdF7ab3b7eD9a8f3D8));
    IERC20 constant VMPX = IERC20(0xCC0c84755384b041470C021D338639EDa8831E09);
    address constant MAILBOX = 0xfFAEF09B3cd11D9b20d1a19bECca54EEC2884766;
    uint32 constant X1 = 1479626325;
    address treasury = makeAddr("vmpx-treasury");
    address user = makeAddr("user");
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
    }

    function test_fork_rolloutAndDeposit() public {
        if (!on) vm.skip(true); // no SEPOLIA_FORK_RPC: reported as skipped, never as passed (Codex round 3, sec. 8)
        uint256 lockedBefore = VMPX.balanceOf(address(R));
        address owner = R.owner();
        bytes32 x1Router = R.routers(X1);
        address ism = address(R.interchainSecurityModule());
        address hook = address(R.hook());

        VmpxCollateralRouter impl = new VmpxCollateralRouter(address(VMPX), MAILBOX, 1e9);
        (address[] memory t, uint256[] memory v, bytes[] memory d) = _batch(address(impl));
        bytes32 salt = keccak256("vmpx-router-v2-fork");
        uint256 delay = TL.getMinDelay();
        address proposer = address(this); // stands in for the testnet deployer (the real proposer)
        _grant(proposer);
        vm.prank(proposer);
        TL.scheduleBatch(t, v, d, bytes32(0), salt, delay);
        vm.warp(block.timestamp + delay);
        vm.prank(proposer);
        TL.executeBatch(t, v, d, bytes32(0), salt);

        assertEq(R.bridgeFeeBps(), 300);
        assertEq(R.treasury(), treasury);
        assertEq(R.maxLocked(), 5_000_000 ether, "testnet TVL cap (v3)");
        assertEq(R.owner(), owner);
        assertEq(R.routers(X1), x1Router);
        assertEq(address(R.interchainSecurityModule()), ism);
        assertEq(address(R.hook()), hook);
        assertEq(VMPX.balanceOf(address(R)), lockedBefore, "collateral untouched");

        deal(address(VMPX), user, 1_000 ether);
        Quote[] memory q = R.quoteTransferRemote(X1, bytes32(uint256(1)), 1_000 ether);
        vm.deal(user, 1 ether);
        vm.startPrank(user);
        VMPX.approve(address(R), 1_000 ether);
        R.transferRemote{value: q[0].amount}(X1, bytes32(uint256(1)), 1_000 ether);
        vm.stopPrank();
        assertEq(VMPX.balanceOf(treasury), 30 ether);
        assertEq(VMPX.balanceOf(address(R)), lockedBefore + 970 ether);
        emit log_named_uint("gas fee quoted (wei)", q[0].amount);
    }

    function test_fork_feeHookFixedGasFee() public {
        if (!on) vm.skip(true); // no SEPOLIA_FORK_RPC: reported as skipped, never as passed (Codex round 3, sec. 8)
        VmpxEthFeeHook.FeeParams memory p = VmpxEthFeeHook.FeeParams({
            feeBps: 0, minFeeWei: 0.0002 ether, maxFeeWei: 0.0002 ether, staleFallbackFeeWei: 0.0002 ether, maxPriceAge: 2 days
        });
        vm.prank(address(TL));
        FH.announceParams(p);
        vm.warp(block.timestamp + FH.PARAM_DELAY());
        vm.prank(address(TL));
        FH.executeParams();
        for (uint256 i; i < 3; i++) {
            (uint256 fee, ) = FH.feeFor([uint256(1e9), 1_000 ether, 100_000_000 ether][i]);
            assertEq(fee, 0.0002 ether);
        }
        vm.warp(block.timestamp + 30 days); // stale price: still 0.0002
        (uint256 f, bool stale) = FH.feeFor(1_000 ether);
        assertTrue(stale);
        assertEq(f, 0.0002 ether);
    }

    function _batch(address impl) internal view returns (address[] memory t, uint256[] memory v, bytes[] memory d) {
        t = new address[](3);
        v = new uint256[](3);
        d = new bytes[](3);
        t[0] = address(PA);
        d[0] = abi.encodeCall(PA.upgrade, (ITransparentUpgradeableProxy(address(R)), impl));
        t[1] = address(R);
        d[1] = abi.encodeCall(R.setBridgeFee, (300, treasury));
        t[2] = address(R);
        d[2] = abi.encodeCall(R.initializeV3, (5_000_000 ether)); // router v3: same batch, otherwise deposits stay closed
    }

    function _grant(address a) internal {
        bytes32[2] memory roles = [TL.PROPOSER_ROLE(), TL.EXECUTOR_ROLE()];
        for (uint256 i; i < 2; i++) {
            vm.prank(address(TL));
            TL.grantRole(roles[i], a);
        }
    }
}
