// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.22;

interface IPausableTarget {
    function pause() external;

    function unpause() external;

    function paused() external view returns (bool);
}

/**
 * @title EmergencyPauser
 * @notice "Fast stop, slow start." Owns the bridge's PausableHook (deposits) and
 *         PausableIsm (unlocks).
 *   - ANY registered pauser (single key: on-call operator, monitoring bot) can pause
 *     everything immediately with one transaction.
 *   - Only the guardian multisig can unpause and manage pausers.
 * A compromised pauser key can only stop the bridge (griefing), never move funds;
 * the guardian removes it and unpauses.
 */
contract EmergencyPauser {
    address public guardian;
    address public pendingGuardian;
    IPausableTarget public immutable depositsPause; // PausableHook
    IPausableTarget public immutable unlocksPause; // PausableIsm
    mapping(address => bool) public isPauser;

    event PauserSet(address indexed pauser, bool enabled);
    event PausedAll(address indexed by, string reason);
    event Unpaused(address indexed by, bool deposits, bool unlocks);
    event GuardianProposed(address indexed guardian);
    event GuardianAccepted(address indexed guardian);

    error NotGuardian();
    error NotPauser();

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(address _guardian, address _depositsPause, address _unlocksPause, address[] memory _pausers) {
        require(_guardian != address(0), "guardian=0");
        guardian = _guardian;
        depositsPause = IPausableTarget(_depositsPause);
        unlocksPause = IPausableTarget(_unlocksPause);
        for (uint256 i; i < _pausers.length; i++) {
            isPauser[_pausers[i]] = true;
            emit PauserSet(_pausers[i], true);
        }
    }

    /// @notice stop deposits AND unlocks. Idempotent: already-paused targets are skipped.
    function pauseAll(string calldata reason) external {
        if (!isPauser[msg.sender] && msg.sender != guardian) revert NotPauser();
        _tryPause(depositsPause);
        _tryPause(unlocksPause);
        emit PausedAll(msg.sender, reason);
    }

    function _tryPause(IPausableTarget t) internal {
        if (!t.paused()) t.pause(); // no try/catch: a failed pause must revert the whole call
    }

    function unpause(bool deposits, bool unlocks) external onlyGuardian {
        if (deposits) depositsPause.unpause();
        if (unlocks) unlocksPause.unpause();
        emit Unpaused(msg.sender, deposits, unlocks);
    }

    function setPauser(address p, bool enabled) external onlyGuardian {
        isPauser[p] = enabled;
        emit PauserSet(p, enabled);
    }

    function proposeGuardian(address g) external onlyGuardian {
        pendingGuardian = g;
        emit GuardianProposed(g);
    }

    function acceptGuardian() external {
        require(msg.sender == pendingGuardian, "not pending");
        guardian = msg.sender;
        pendingGuardian = address(0);
        emit GuardianAccepted(msg.sender);
    }
}
