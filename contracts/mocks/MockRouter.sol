// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IDexRouter} from "../interfaces/IDexRouter.sol";

interface IMintableERC20 is IERC20 {
    function mint(address to, uint256 amount) external;
}

/**
 * @title MockRouter
 * @notice Test double implementing the Uniswap V2-style {IDexRouter} interface.
 *         Pulls `amountIn` of `path[0]` and mints a *value-preserving,
 *         decimal-correct* amount of `path[1]` back to `to`, using per-token USD
 *         prices set by {setTokenPrice}. This mirrors how {SableVault}'s agent
 *         sizes swaps (equal USD value in/out, minus slippage), so a swap that
 *         the agent priced against live market data clears the on-chain slippage
 *         floor instead of reverting on a decimal/price mismatch.
 * @dev A flat rate can't do this: OKB/USDC/WETH differ in both price (~$50 vs $1
 *      vs ~$1900) and decimals (18 vs 6 vs 18). Output is computed as
 *      `amountIn * priceIn * 10^decOut / (priceOut * 10^decIn)`, reading each
 *      token's `decimals()` on-chain. Prices are permissionless to set — this is
 *      a testnet mock, not production. Seed them at deploy from the same source
 *      the agent prices against (CoinGecko) so the two agree within slippage.
 */
contract MockRouter is IDexRouter {
    /// @notice USD price per whole token, 8 decimals (1e8 == $1.00). 0 == unset.
    mapping(address => uint256) public priceUSD;

    /// @notice Decimals used for the USD price fixed-point (matches the vault's USD_DECIMALS).
    uint256 public constant PRICE_DECIMALS = 8;

    event TokenPriceSet(address indexed token, uint256 priceUSD);

    /// @notice Set one token's USD price (8-decimal fixed point, e.g. $1900 => 190000000000).
    function setTokenPrice(address token, uint256 priceUSD8) external {
        priceUSD[token] = priceUSD8;
        emit TokenPriceSet(token, priceUSD8);
    }

    /// @notice Batch variant of {setTokenPrice}.
    function setTokenPrices(address[] calldata tokens, uint256[] calldata prices) external {
        require(tokens.length == prices.length, "MockRouter: length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            priceUSD[tokens[i]] = prices[i];
            emit TokenPriceSet(tokens[i], prices[i]);
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "MockRouter: expired");
        require(path.length >= 2, "MockRouter: bad path");

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        IMintableERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        uint256 amountOut = getAmountOut(tokenIn, tokenOut, amountIn);
        require(amountOut >= amountOutMin, "MockRouter: insufficient output");
        IMintableERC20(tokenOut).mint(to, amountOut);

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    /**
     * @notice Value-preserving output for `amountIn` of `tokenIn` in `tokenOut`,
     *         corrected for each token's decimals:
     *           valueUSD  = amountIn * pIn / 10^decIn
     *           amountOut = valueUSD * 10^decOut / pOut
     *         Grouped to keep precision before the single division.
     */
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) public view returns (uint256) {
        uint256 pIn = priceUSD[tokenIn];
        uint256 pOut = priceUSD[tokenOut];
        require(pIn > 0 && pOut > 0, "MockRouter: price unset");
        uint8 decIn = IERC20Metadata(tokenIn).decimals();
        uint8 decOut = IERC20Metadata(tokenOut).decimals();
        return (amountIn * pIn * (10 ** decOut)) / (pOut * (10 ** decIn));
    }
}
