import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SableVault, MockERC20, MockRouter } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// USD values use 8 decimals in the vault. Helper to build them.
const USD = (n: number) => ethers.parseUnits(n.toString(), 8);
// Token amounts — mocks use 18 decimals.
const TOK = (n: number) => ethers.parseUnits(n.toString(), 18);
// Router prices are 8-decimal USD fixed point (1e8 == $1.00).
const PRICE = (usd: number) => ethers.parseUnits(usd.toString(), 8);

describe("SableVault", () => {
  let vault: SableVault;
  let router: MockRouter;
  let tokenIn: MockERC20;
  let tokenOut: MockERC20;
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let user: SignerWithAddress;
  let attacker: SignerWithAddress;

  beforeEach(async () => {
    [owner, agent, user, attacker] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("MockERC20");
    tokenIn = (await ERC20.deploy("Token In", "TIN", 18)) as unknown as MockERC20;
    tokenOut = (await ERC20.deploy("Token Out", "TOUT", 18)) as unknown as MockERC20;

    const Router = await ethers.getContractFactory("MockRouter");
    router = (await Router.deploy()) as unknown as MockRouter;

    // Both mock tokens priced at $1 with equal (18) decimals => a swap returns
    // 1:1 by default, which keeps the value-based assertions below simple.
    await router.setTokenPrices(
      [await tokenIn.getAddress(), await tokenOut.getAddress()],
      [PRICE(1), PRICE(1)]
    );

    const Vault = await ethers.getContractFactory("SableVault");
    vault = (await Vault.deploy(owner.address, agent.address)) as unknown as SableVault;

    // Fund the user and approve the vault.
    await tokenIn.mint(user.address, TOK(1000));
    await tokenIn.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  describe("deployment", () => {
    it("sets owner and agent", async () => {
      expect(await vault.owner()).to.equal(owner.address);
      expect(await vault.agent()).to.equal(agent.address);
    });
  });

  describe("deposit / withdraw accounting", () => {
    it("credits deposits and emits", async () => {
      await expect(vault.connect(user).deposit(await tokenIn.getAddress(), TOK(100)))
        .to.emit(vault, "Deposited")
        .withArgs(user.address, await tokenIn.getAddress(), TOK(100));

      expect(await vault.balanceOf(user.address, await tokenIn.getAddress())).to.equal(TOK(100));
      expect(await tokenIn.balanceOf(await vault.getAddress())).to.equal(TOK(100));
    });

    it("accumulates multiple deposits", async () => {
      await vault.connect(user).deposit(await tokenIn.getAddress(), TOK(100));
      await vault.connect(user).deposit(await tokenIn.getAddress(), TOK(50));
      expect(await vault.balanceOf(user.address, await tokenIn.getAddress())).to.equal(TOK(150));
    });

    it("lets the user withdraw their own funds", async () => {
      await vault.connect(user).deposit(await tokenIn.getAddress(), TOK(100));
      await expect(vault.connect(user).withdraw(await tokenIn.getAddress(), TOK(40)))
        .to.emit(vault, "Withdrawn")
        .withArgs(user.address, await tokenIn.getAddress(), TOK(40));

      expect(await vault.balanceOf(user.address, await tokenIn.getAddress())).to.equal(TOK(60));
      expect(await tokenIn.balanceOf(user.address)).to.equal(TOK(940)); // 1000 - 100 + 40
    });

    it("reverts withdrawing more than balance", async () => {
      await vault.connect(user).deposit(await tokenIn.getAddress(), TOK(100));
      await expect(
        vault.connect(user).withdraw(await tokenIn.getAddress(), TOK(101))
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });

    it("reverts zero-amount deposit and withdraw", async () => {
      await expect(
        vault.connect(user).deposit(await tokenIn.getAddress(), 0)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
      await expect(
        vault.connect(user).withdraw(await tokenIn.getAddress(), 0)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("keeps balances isolated between users", async () => {
      await tokenIn.mint(attacker.address, TOK(10));
      await tokenIn.connect(attacker).approve(await vault.getAddress(), ethers.MaxUint256);
      await vault.connect(user).deposit(await tokenIn.getAddress(), TOK(100));
      await vault.connect(attacker).deposit(await tokenIn.getAddress(), TOK(10));

      // Attacker cannot withdraw the user's funds — only their own 10.
      await expect(
        vault.connect(attacker).withdraw(await tokenIn.getAddress(), TOK(11))
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });
  });

  describe("executeSwap authorization", () => {
    beforeEach(async () => {
      await vault.connect(user).deposit(await tokenIn.getAddress(), TOK(100));
      await vault.connect(user).setRiskLimit(USD(1000));
    });

    it("reverts when a non-agent calls executeSwap", async () => {
      await expect(
        vault
          .connect(attacker)
          .executeSwap(
            user.address,
            await tokenIn.getAddress(),
            await tokenOut.getAddress(),
            TOK(10),
            0,
            USD(100),
            await router.getAddress()
          )
      ).to.be.revertedWithCustomError(vault, "NotAgent");
    });

    it("reverts when the owner (but not agent) calls executeSwap", async () => {
      await expect(
        vault
          .connect(owner)
          .executeSwap(
            user.address,
            await tokenIn.getAddress(),
            await tokenOut.getAddress(),
            TOK(10),
            0,
            USD(100),
            await router.getAddress()
          )
      ).to.be.revertedWithCustomError(vault, "NotAgent");
    });

    it("executes a swap for the agent and credits tokenOut", async () => {
      await expect(
        vault
          .connect(agent)
          .executeSwap(
            user.address,
            await tokenIn.getAddress(),
            await tokenOut.getAddress(),
            TOK(10),
            TOK(10),
            USD(100),
            await router.getAddress()
          )
      ).to.emit(vault, "SwapExecuted");

      expect(await vault.balanceOf(user.address, await tokenIn.getAddress())).to.equal(TOK(90));
      expect(await vault.balanceOf(user.address, await tokenOut.getAddress())).to.equal(TOK(10));
    });

    it("reverts on slippage when router returns less than minAmountOut", async () => {
      // tokenOut costs 2x tokenIn, so $ of tokenIn buys only 0.5x tokenOut.
      await router.setTokenPrice(await tokenOut.getAddress(), PRICE(2));
      await expect(
        vault
          .connect(agent)
          .executeSwap(
            user.address,
            await tokenIn.getAddress(),
            await tokenOut.getAddress(),
            TOK(10),
            TOK(10), // demand 1:1 but router gives 0.5x
            USD(100),
            await router.getAddress()
          )
      ).to.be.reverted; // router reverts "insufficient output"
    });
  });

  describe("risk limit enforcement", () => {
    beforeEach(async () => {
      await vault.connect(user).deposit(await tokenIn.getAddress(), TOK(1000));
    });

    it("reverts agent swaps when no limit is set", async () => {
      await expect(
        vault
          .connect(agent)
          .executeSwap(
            user.address,
            await tokenIn.getAddress(),
            await tokenOut.getAddress(),
            TOK(10),
            0,
            USD(100),
            await router.getAddress()
          )
      ).to.be.revertedWithCustomError(vault, "RiskLimitNotSet");
    });

    it("sets a limit and emits", async () => {
      await expect(vault.connect(user).setRiskLimit(USD(500)))
        .to.emit(vault, "RiskLimitSet")
        .withArgs(user.address, USD(500));
      expect(await vault.availableDailyNotional(user.address)).to.equal(USD(500));
    });

    it("allows swaps up to the cap and blocks the one that exceeds it", async () => {
      await vault.connect(user).setRiskLimit(USD(500));

      // Two swaps of $200 are fine (total $400).
      await vault.connect(agent).executeSwap(
        user.address, await tokenIn.getAddress(), await tokenOut.getAddress(),
        TOK(20), 0, USD(200), await router.getAddress()
      );
      await vault.connect(agent).executeSwap(
        user.address, await tokenIn.getAddress(), await tokenOut.getAddress(),
        TOK(20), 0, USD(200), await router.getAddress()
      );
      expect(await vault.availableDailyNotional(user.address)).to.equal(USD(100));

      // A third $200 swap exceeds the remaining $100 and must revert.
      await expect(
        vault.connect(agent).executeSwap(
          user.address, await tokenIn.getAddress(), await tokenOut.getAddress(),
          TOK(20), 0, USD(200), await router.getAddress()
        )
      ).to.be.revertedWithCustomError(vault, "DailyLimitExceeded");
    });

    it("resets the allowance after a day passes", async () => {
      await vault.connect(user).setRiskLimit(USD(500));
      await vault.connect(agent).executeSwap(
        user.address, await tokenIn.getAddress(), await tokenOut.getAddress(),
        TOK(40), 0, USD(400), await router.getAddress()
      );
      expect(await vault.availableDailyNotional(user.address)).to.equal(USD(100));

      await time.increase(24 * 60 * 60 + 1);

      // Fresh day => full cap available again.
      expect(await vault.availableDailyNotional(user.address)).to.equal(USD(500));
      await expect(
        vault.connect(agent).executeSwap(
          user.address, await tokenIn.getAddress(), await tokenOut.getAddress(),
          TOK(40), 0, USD(400), await router.getAddress()
        )
      ).to.emit(vault, "SwapExecuted");
    });

    it("blocks further trades if the user lowers the cap below today's spend", async () => {
      await vault.connect(user).setRiskLimit(USD(500));
      await vault.connect(agent).executeSwap(
        user.address, await tokenIn.getAddress(), await tokenOut.getAddress(),
        TOK(40), 0, USD(400), await router.getAddress()
      );
      await vault.connect(user).setRiskLimit(USD(100)); // below the $400 spent
      expect(await vault.availableDailyNotional(user.address)).to.equal(0);
      await expect(
        vault.connect(agent).executeSwap(
          user.address, await tokenIn.getAddress(), await tokenOut.getAddress(),
          TOK(1), 0, USD(1), await router.getAddress()
        )
      ).to.be.revertedWithCustomError(vault, "DailyLimitExceeded");
    });
  });

  describe("pause behavior", () => {
    beforeEach(async () => {
      await vault.connect(user).deposit(await tokenIn.getAddress(), TOK(100));
      await vault.connect(user).setRiskLimit(USD(1000));
    });

    it("only the owner can pause", async () => {
      await expect(vault.connect(attacker).pause()).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount"
      );
    });

    it("blocks deposits and agent swaps while paused", async () => {
      await vault.connect(owner).pause();
      await expect(
        vault.connect(user).deposit(await tokenIn.getAddress(), TOK(1))
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
      await expect(
        vault.connect(agent).executeSwap(
          user.address, await tokenIn.getAddress(), await tokenOut.getAddress(),
          TOK(10), 0, USD(100), await router.getAddress()
        )
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("still allows withdrawals while paused (funds never locked)", async () => {
      await vault.connect(owner).pause();
      await expect(vault.connect(user).withdraw(await tokenIn.getAddress(), TOK(100)))
        .to.emit(vault, "Withdrawn")
        .withArgs(user.address, await tokenIn.getAddress(), TOK(100));
    });

    it("resumes after unpause", async () => {
      await vault.connect(owner).pause();
      await vault.connect(owner).unpause();
      await expect(
        vault.connect(user).deposit(await tokenIn.getAddress(), TOK(1))
      ).to.emit(vault, "Deposited");
    });
  });

  describe("agent administration", () => {
    it("lets the owner rotate the agent and blocks the old one", async () => {
      await vault.connect(user).deposit(await tokenIn.getAddress(), TOK(100));
      await vault.connect(user).setRiskLimit(USD(1000));

      await expect(vault.connect(owner).setAgent(attacker.address))
        .to.emit(vault, "AgentUpdated")
        .withArgs(agent.address, attacker.address);

      // Old agent is now unauthorized.
      await expect(
        vault.connect(agent).executeSwap(
          user.address, await tokenIn.getAddress(), await tokenOut.getAddress(),
          TOK(10), 0, USD(100), await router.getAddress()
        )
      ).to.be.revertedWithCustomError(vault, "NotAgent");
    });

    it("blocks non-owners from rotating the agent", async () => {
      await expect(
        vault.connect(attacker).setAgent(attacker.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });
});
