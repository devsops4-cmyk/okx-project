// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDexRouter
 * @notice Minimal Uniswap V2-style router interface used by {SableVault}.
 * @dev Most DEXes on X Layer expose this signature. If the DEX you target is
 *      Uniswap V3-only, swap this for an `exactInputSingle`-based interface and
 *      adjust {SableVault-executeSwap} accordingly.
 */
interface IDexRouter {
    /**
     * @notice Swaps an exact amount of input tokens for as many output tokens as
     *         possible, along the route determined by `path`.
     * @param amountIn      The exact amount of input tokens to send.
     * @param amountOutMin  The minimum acceptable amount of output tokens.
     * @param path          The token swap path (e.g. [tokenIn, tokenOut]).
     * @param to            Recipient of the output tokens.
     * @param deadline      Unix timestamp after which the tx reverts.
     * @return amounts      The input amount and all subsequent output amounts.
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
