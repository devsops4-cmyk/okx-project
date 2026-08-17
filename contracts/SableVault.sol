// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IDexRouter} from "./interfaces/IDexRouter.sol";

/**
 * @title SableVault
 * @author Sable
 * @notice Non-custodial trading vault for the Sable AI co-pilot on X Layer.
 *
 *         Users deposit ERC20 tokens into their own tracked balance. An
 *         authorized off-chain "agent" (the Sable backend) may execute swaps on
 *         a user's behalf through a DEX router — but ONLY within a per-user,
 *         per-day USD notional cap that the user sets themselves on-chain. Users
 *         can withdraw their funds at any time; the agent can never withdraw to
 *         itself, and the owner can never touch user balances.
 *
 * @dev Trust model & the USD cap:
 *      The daily cap is denominated in USD because that is what a human risk
 *      limit means ("let the bot trade at most $500/day"). Valuing an arbitrary
 *      token `amountIn` in USD on-chain would require a price oracle, which is
 *      out of scope for this build. Instead the agent passes `amountInUSD`
 *      alongside each swap, and the contract enforces + accumulates it against
 *      the user's cap. The residual trust assumption is therefore narrow and
 *      explicit: the agent reports the notional truthfully. The upgrade path is
 *      to replace the passed-in value with a Chainlink/oracle read. Everything
 *      else — that the bot cannot exceed the cap, cannot trade with no cap set,
 *      and cannot move funds out of the vault — is enforced trustlessly here.
 *
 *      USD amounts (`amountInUSD`, `maxDailyNotionalUSD`) are integers using
 *      {USD_DECIMALS} decimals of precision. The frontend and agent MUST scale
 *      consistently (e.g. $500.00 -> 500 * 10**USD_DECIMALS).
 */
contract SableVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Fixed-point decimals used for all USD-denominated values.
    uint8 public constant USD_DECIMALS = 8;

    /// @notice Seconds added to `block.timestamp` to form each swap's deadline.
    uint256 private constant SWAP_DEADLINE_BUFFER = 300;

    /// @notice Length of a "day" for the rolling notional window.
    uint256 private constant DAY = 1 days;

    // ─────────────────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Wallet authorized to call {executeSwap}. Set by the owner.
    address public agent;

    /// @notice user => token => amount held in the vault for that user.
    mapping(address => mapping(address => uint256)) public balances;

    /// @notice Per-user daily risk configuration.
    struct RiskLimit {
        uint256 maxDailyNotionalUSD; // 0 == not set == agent trading disabled
        uint256 spentTodayUSD; // notional already used in `currentDay`
        uint256 currentDay; // block.timestamp / DAY when spentToday last moved
    }

    /// @notice user => their on-chain risk limit state.
    mapping(address => RiskLimit) public riskLimits;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event SwapExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 amountInUSD,
        address router
    );
    event RiskLimitSet(address indexed user, uint256 maxDailyNotionalUSD);
    event AgentUpdated(address indexed previousAgent, address indexed newAgent);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error SameToken();
    error NotAgent();
    error InsufficientBalance(uint256 available, uint256 requested);
    error RiskLimitNotSet();
    error DailyLimitExceeded(uint256 available, uint256 requested);
    error SlippageExceeded(uint256 received, uint256 minAmountOut);

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Restricts a function to the authorized agent wallet.
    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param initialOwner Admin able to pause and rotate the agent.
     * @param initialAgent Wallet initially authorized to call {executeSwap}.
     *                     May be the zero address to configure it later.
     */
    constructor(address initialOwner, address initialAgent) Ownable(initialOwner) {
        agent = initialAgent;
        emit AgentUpdated(address(0), initialAgent);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User deposit / withdraw (funds are never locked)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposit `amount` of `token` into the caller's vault balance.
     * @dev Requires prior ERC20 approval of this contract for `amount`.
     *      Credits the balance by the amount actually received, so it remains
     *      correct even for fee-on-transfer tokens.
     * @param token  ERC20 token address to deposit.
     * @param amount Amount to deposit (token's own decimals).
     */
    function deposit(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20 erc20 = IERC20(token);
        uint256 balanceBefore = erc20.balanceOf(address(this));
        erc20.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = erc20.balanceOf(address(this)) - balanceBefore;

        balances[msg.sender][token] += received;
        emit Deposited(msg.sender, token, received);
    }

    /**
     * @notice Withdraw `amount` of `token` from the caller's vault balance.
     * @dev Intentionally NOT gated by `whenNotPaused`: users must always be able
     *      to exit, even during an emergency pause.
     * @param token  ERC20 token address to withdraw.
     * @param amount Amount to withdraw (token's own decimals).
     */
    function withdraw(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balances[msg.sender][token];
        if (bal < amount) revert InsufficientBalance(bal, amount);

        balances[msg.sender][token] = bal - amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User-controlled risk limit (trustless setting)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Set the caller's maximum daily notional the agent may trade, in
     *         USD scaled by {USD_DECIMALS}.
     * @dev Setting this to a non-zero value is REQUIRED before the agent can
     *      execute any swap for the caller — an unset (zero) limit means agent
     *      trading is disabled. Set to 0 to fully disable agent trading again.
     *      Does not retroactively refund `spentTodayUSD`; lowering the cap below
     *      today's spend simply blocks further trades until the next day.
     * @param maxDailyNotionalUSD New daily cap (USD, {USD_DECIMALS} decimals).
     */
    function setRiskLimit(uint256 maxDailyNotionalUSD) external {
        riskLimits[msg.sender].maxDailyNotionalUSD = maxDailyNotionalUSD;
        emit RiskLimitSet(msg.sender, maxDailyNotionalUSD);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Agent-executed swap (gated by the on-chain USD cap)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Execute a swap on `user`'s behalf via a DEX `router`, moving
     *         `amountIn` of their `tokenIn` into `tokenOut`, all within the
     *         vault. Callable only by the authorized agent.
     * @dev Enforces the caller-set daily USD cap BEFORE swapping (see contract
     *      docs for the oracle trust note on `amountInUSD`). Follows
     *      checks-effects-interactions and is `nonReentrant`: the user's
     *      `tokenIn` balance is debited before the external router call, and the
     *      `tokenOut` credit is measured from the actual received delta.
     * @param user         The vault user whose funds are being traded.
     * @param tokenIn       Token to sell (must be in the user's balance).
     * @param tokenOut      Token to buy.
     * @param amountIn      Amount of `tokenIn` to sell.
     * @param minAmountOut  Minimum acceptable `tokenOut` (slippage floor).
     * @param amountInUSD   Notional value of this swap in USD ({USD_DECIMALS}).
     * @param router        DEX router implementing {IDexRouter}.
     * @return amountOut    Amount of `tokenOut` credited to the user.
     */
    function executeSwap(
        address user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 amountInUSD,
        address router
    ) external onlyAgent nonReentrant whenNotPaused returns (uint256 amountOut) {
        if (user == address(0) || tokenIn == address(0) || tokenOut == address(0) || router == address(0)) {
            revert ZeroAddress();
        }
        if (tokenIn == tokenOut) revert SameToken();
        if (amountIn == 0) revert ZeroAmount();

        uint256 userIn = balances[user][tokenIn];
        if (userIn < amountIn) revert InsufficientBalance(userIn, amountIn);

        // ── Risk-limit check (effects on the rolling window) ─────────────────
        _consumeDailyNotional(user, amountInUSD);

        // ── Effects: debit before the external call ──────────────────────────
        balances[user][tokenIn] = userIn - amountIn;

        // ── Interaction: perform the swap, credit the measured delta ─────────
        IERC20(tokenIn).forceApprove(router, amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));
        IDexRouter(router).swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            path,
            address(this),
            block.timestamp + SWAP_DEADLINE_BUFFER
        );
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - outBefore;

        // Defense in depth: routers should already enforce this, but never
        // credit less than the slippage floor without reverting.
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        // Clear any residual approval to keep the vault tidy.
        IERC20(tokenIn).forceApprove(router, 0);

        balances[user][tokenOut] += amountOut;
        emit SwapExecuted(user, tokenIn, tokenOut, amountIn, amountOut, amountInUSD, router);
    }

    /**
     * @dev Enforce and accumulate `amountInUSD` against `user`'s daily cap,
     *      rolling the window over at day boundaries. Reverts if the user has no
     *      cap set, or if this swap would exceed the remaining allowance.
     */
    function _consumeDailyNotional(address user, uint256 amountInUSD) private {
        RiskLimit storage rl = riskLimits[user];
        if (rl.maxDailyNotionalUSD == 0) revert RiskLimitNotSet();

        uint256 today = block.timestamp / DAY;
        uint256 spent = rl.currentDay == today ? rl.spentTodayUSD : 0;

        uint256 available = rl.maxDailyNotionalUSD > spent ? rl.maxDailyNotionalUSD - spent : 0;
        if (amountInUSD > available) revert DailyLimitExceeded(available, amountInUSD);

        rl.spentTodayUSD = spent + amountInUSD;
        rl.currentDay = today;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Owner administration
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Update the authorized agent wallet.
     * @param newAgent New agent address (may be zero to disable agent trading).
     */
    function setAgent(address newAgent) external onlyOwner {
        emit AgentUpdated(agent, newAgent);
        agent = newAgent;
    }

    /// @notice Pause deposits and agent swaps in an emergency. Withdrawals stay open.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Lift a pause.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The vault balance of `token` held for `user`.
    function balanceOf(address user, address token) external view returns (uint256) {
        return balances[user][token];
    }

    /**
     * @notice Remaining USD notional the agent may trade for `user` today,
     *         accounting for the day rollover. Returns 0 if no cap is set.
     */
    function availableDailyNotional(address user) external view returns (uint256) {
        RiskLimit storage rl = riskLimits[user];
        if (rl.maxDailyNotionalUSD == 0) return 0;
        uint256 today = block.timestamp / DAY;
        uint256 spent = rl.currentDay == today ? rl.spentTodayUSD : 0;
        return rl.maxDailyNotionalUSD > spent ? rl.maxDailyNotionalUSD - spent : 0;
    }
}
