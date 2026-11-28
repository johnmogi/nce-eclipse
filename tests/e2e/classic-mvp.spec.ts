import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOT_DIR = path.resolve(process.cwd(), 'test-results', 'classic-mvp-shots');

function ensureShotDir() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
}

test.describe('Classic MVP Re-Scaffold — Full-Game Browser Acceptance (Scenarios A–E)', () => {
  test.beforeAll(() => {
    ensureShotDir();
  });

  test('Scenario B (Strategic Turn-1 Eclipse on mvp-e2e-136): Fire burns Event -> K♠ meets K♥ in Parallel -> Eclipse Resolution Spotlight pauses -> persistent ☀ K +3 trophy locks beside Ace -> continues to Reading', async ({
    page
  }) => {
    await page.goto('/');

    const seedInput = page.locator('input[placeholder="custom seed"]');
    await seedInput.fill('mvp-e2e-136');
    await page.getByRole('button', { name: 'New Game' }).click();

    // Verify Parallel holds K♥ (Dormant) and Deck of Days #1 Next Upcoming shows a Major back!
    await expect(page.getByTestId('board-slot-parallel')).toContainText('K♥');
    await expect(page.getByTestId('board-slot-parallel')).toContainText('Dormant');
    await page.getByTestId('deck-of-days-zone').click();
    await expect(page.getByTestId('immediate-future-card-1')).toContainText('Major back');
    await page.getByRole('button', { name: 'Close Browser' }).click();

    // Activate 4♣ (Fire) on Board Event -> burns Event -> draws K♠ -> K♠ meets K♥ in Parallel -> ECLIPSE!
    await page.locator('.hand-cards-grid .card-chip', { hasText: '4♣' }).click();
    await page.getByTestId('board-slot-event').click();
    await page.getByTestId('confirm-prep-elemental-btn').click();

    // Verify the Eclipse Resolution Spotlight pauses clearly showing both Courts + permanent +3 VP + 1/3 Eclipses!
    const overlay = page.getByTestId('eclipse-resolution-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('ECLIPSE FORMED');
    await expect(overlay).toContainText('K♥');
    await expect(overlay).toContainText('K♠');
    await expect(overlay).toContainText('+3 VP');
    await expect(overlay).toContainText('1 / 3');
    await page.screenshot({ path: path.join(SHOT_DIR, 'mvp-01-eclipse-spotlight.png'), fullPage: true });

    // Acknowledge Eclipse -> spotlight closes, persistent trophy ☀ K +3 sits beside Player 1's Ace, Reading proceeds!
    await page.getByTestId('acknowledge-eclipse-btn').click();
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId('player-eclipse-trophies-p1')).toContainText('☀ K +3');
    await expect(page.getByTestId('player-eclipse-count-p1')).toContainText('1/3');
    await expect(page.getByTestId('accept-center-btn')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(SHOT_DIR, 'mvp-02-after-eclipse-trophy-and-reading.png'), fullPage: true });
  });

  test('Scenario C (Contested Major on mvp-e2e-46): non-matching J♥ arrival resolves via Parallel LIFO contention with zero overflow into Event/Center', async ({
    page
  }) => {
    await page.goto('/');

    const seedInput = page.locator('input[placeholder="custom seed"]');
    await seedInput.fill('mvp-e2e-46');
    await page.getByRole('button', { name: 'New Game' }).click();

    // Turn 1: K♠ starts in Parallel, J♥ is #1 Next Upcoming in Deck of Days
    await expect(page.getByTestId('board-slot-parallel')).toContainText('K♠');
    await page.getByTestId('proceed-to-reading-btn').click();
    await expect(page.getByTestId('accept-center-btn')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('accept-center-btn').click();
    await page.getByTestId('resolve-event-btn').click();
    await page.getByTestId('end-turn-btn').click();

    // Turn 2: K♠ awakens (Active), J♥ arrives -> LIFO sends J♥ to Veil, K♠ remains Active in Parallel!
    await expect(page.getByRole('button', { name: 'Advise: GOOD' })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId('board-slot-parallel')).toContainText('K♠');
    await expect(page.getByTestId('board-slot-parallel')).toContainText('Active');
    await page.getByTestId('veil-zone').click();
    await expect(page.getByTestId('veil-browser')).toContainText('J♥');
  });

  test('Scenarios A, D & E (Full Multi-Round Human vs Bot: Earn & Spend Free Bonus with Clear Guidance, Round-2 Trading Market Exchange, and Legal Endgame)', async ({
    page
  }) => {
    test.setTimeout(90_000);
    await page.goto('/');

    const seedInput = page.locator('input[placeholder="custom seed"]');
    await seedInput.fill('v2-e2e-11');
    await page.getByRole('button', { name: 'New Game' }).click();

    // Round 1 Turn 1: Human skips Prep, pursues Treasure, finishes Turn 1
    await page.getByTestId('proceed-to-reading-btn').click();
    await expect(page.getByTestId('accept-center-btn')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('accept-center-btn').click();
    await page.getByTestId('resolve-event-btn').click();
    await page.getByTestId('end-turn-btn').click();

    // Round 1 Turn 2: Human advises BAD -> Bot follows & discards -> grants Human a Free Reader Bonus!
    const adviseBad = page.getByRole('button', { name: 'Advise: BAD' });
    await expect(adviseBad).toBeVisible({ timeout: 12_000 });
    await adviseBad.click();

    // Round 2 Turn 3: Verify clickable Reader Bonus pill on Player Identity Bar AND explicit guidance strip!
    await expect(page.getByText('Round 2 · Turn 3')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('player-bonus-pill-p1')).toBeVisible();
    await expect(page.getByTestId('reader-bonus-guidance')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, 'mvp-03-bonus-pill-and-guidance.png'), fullPage: true });

    // Spend Free Reader Bonus cleanly right from the player identity pill!
    await page.getByTestId('player-bonus-pill-p1').click();
    const peekBtn = page.getByTestId('start-earth-peek-btn');
    if (await peekBtn.isVisible().catch(() => false)) {
      await peekBtn.click();
      await expect(page.getByTestId('earth-peek-cards')).toBeVisible();
      await page.getByTestId('earth-send-bottom-btn').click();
    } else if (await page.getByTestId('veil-browser').isVisible().catch(() => false)) {
      await page.getByTestId('veil-browser').locator('.browser-item-card.clickable').first().click();
      await page.getByTestId('confirm-bonus-elemental-btn').click();
    } else {
      await page.getByTestId('immediate-future-card-1').click();
      await page.getByTestId('confirm-bonus-elemental-btn').click();
    }

    // Complete Turn 3 (close browser if open; handle AB-1 abandoned card if Bot abandoned on Turn 2, else normal Reading -> Resolve -> End Turn)
    const closeBrowser = page.getByRole('button', { name: 'Close Browser' });
    if (await closeBrowser.isVisible().catch(() => false)) await closeBrowser.click();
    const closeVeil = page.getByRole('button', { name: 'Close Veil' });
    if (await closeVeil.isVisible().catch(() => false)) await closeVeil.click();
    if (await page.getByTestId('claim-abandoned-btn').isVisible().catch(() => false)) {
      await page.getByTestId('claim-abandoned-btn').click();
    } else {
      if (await page.getByTestId('proceed-to-reading-btn').isVisible().catch(() => false)) {
        await page.getByTestId('proceed-to-reading-btn').click();
      }
      if (await page.getByTestId('accept-center-btn').isVisible({ timeout: 10_000 }).catch(() => false)) {
        await page.getByTestId('accept-center-btn').click();
      }
      const resolveBtn = page.getByTestId('resolve-event-btn');
      if (await resolveBtn.isVisible().catch(() => false)) {
        if (await resolveBtn.isEnabled()) {
          await resolveBtn.click();
        } else {
          await page.getByRole('button', { name: 'Leave for Next Player' }).click();
        }
      }
    }
    // Dismiss any Eclipse spotlight if one formed
    if (await page.getByTestId('acknowledge-eclipse-btn').isVisible().catch(() => false)) {
      await page.getByTestId('acknowledge-eclipse-btn').click();
    }
    await expect(page.getByTestId('end-turn-btn')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('end-turn-btn').click();

    // Round 2 Turn 4: Bot takes Prep then prompts Human as Reader -> advise GOOD -> Round 2 ends -> Trading Market opens!
    const adviseGood = page.getByRole('button', { name: 'Advise: GOOD' });
    await expect(adviseGood).toBeVisible({ timeout: 12_000 });
    await adviseGood.click();

    // Trading Market MUST open automatically after Round 2!
    const marketPanel = page.getByTestId('market-panel');
    await expect(marketPanel).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: path.join(SHOT_DIR, 'mvp-04-trading-market-open.png'), fullPage: true });

    // Propose a 1-way gift or 1-for-1 trade to Bot so Bot evaluates & accepts cleanly!
    const firstMarketCard = page.getByTestId('market-hand-grid').locator('.card-chip').first();
    if (await firstMarketCard.isVisible().catch(() => false)) {
      await firstMarketCard.click();
      await page.getByTestId('market-req-count-0').click();
      await page.getByTestId('propose-trade-btn').click();
      await expect(marketPanel).toContainText('1 completed', { timeout: 10_000 });
    }

    // Close Market -> Round 3 begins cleanly!
    await page.getByTestId('close-market-btn').click();
    await expect(page.getByText('Round 3 · Turn 5')).toBeVisible({ timeout: 10_000 });

    // Acknowledge Eclipse Spotlight if Turn 5's Board refill formed a live Eclipse!
    if (await page.getByTestId('acknowledge-eclipse-btn').isVisible().catch(() => false)) {
      await page.getByTestId('acknowledge-eclipse-btn').click();
    }

    // Switch to Auto-Sim to drive remaining rounds cleanly to a legal endgame summary!
    await page.getByRole('button', { name: 'Auto-Sim' }).click();
    // Dismiss any Eclipse spotlight triggered during Auto-Sim if present, then assert legal endgame
    await expect(page.getByTestId('endgame-summary')).toBeVisible({ timeout: 45_000 });
    while (await page.getByTestId('acknowledge-eclipse-btn').isVisible().catch(() => false)) {
      await page.getByTestId('acknowledge-eclipse-btn').click();
    }
    await page.screenshot({ path: path.join(SHOT_DIR, 'mvp-05-endgame-summary.png'), fullPage: true });
  });
});
