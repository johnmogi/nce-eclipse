import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOT_DIR = path.resolve(process.cwd(), 'test-results', 'r1-walkthrough-shots');

function ensureShotDir() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
}

test.describe('Stage R1 — Real Browser Acceptance Walkthrough (Human vs Bot)', () => {
  test.beforeAll(() => {
    ensureShotDir();
  });

  test('Walkthrough A (e2e-seed-5): 3/3 fresh start, empty Veil, optional pre-reading Elemental Action, autonomous Bot Reading, Treasure claim, Turn 2 Bot completion, and Turn 3 Reader Bonus activation', async ({
    page
  }) => {
    await page.goto('/');

    // 1. Verify default fresh Turn 1 starts with 3/3 cards & empty Veil
    await expect(page.getByText('NEXUS ECLIPSE')).toBeVisible();
    await expect(page.getByTestId('veil-zone')).toContainText('0 cards');
    await expect(page.getByText('Your hand (3/5)')).toBeVisible();

    // Load deterministic seed e2e-seed-5 (Event 7♦ Treasure, P1 hand 2♥/5♠/8♠, clean Turns 1-3 with Reader Bonus)
    const seedInput = page.locator('input[placeholder="custom seed"]');
    await seedInput.fill('e2e-seed-5');
    await page.getByRole('button', { name: 'New Game' }).click();

    await expect(page.getByText('Round 1 · Turn 1')).toBeVisible();
    await expect(page.getByTestId('veil-zone')).toContainText('0 cards');
    await expect(page.getByText('Your hand (3/5)')).toBeVisible();
    await expect(page.getByText('Hand: 3/5').first()).toBeVisible();
    await expect(page.getByTestId('proceed-to-reading-btn')).toBeVisible();

    // Inspect Deck of Days browser ("Immediate Future" border & Next Upcoming (#1))
    await page.getByTestId('deck-of-days-zone').click();
    await expect(page.getByTestId('immediate-future-zone')).toBeVisible();
    await expect(page.getByTestId('immediate-future-zone')).toContainText('Next Upcoming (#1)');
    await page.screenshot({ path: path.join(SHOT_DIR, '01-turn1-fresh-immediate-future.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close Browser' }).click();

    // 2. Optional Pre-Reading Elemental Action: activate 5♠ (Air) on Deck of Days -> shuffle -> auto-advances to Reading!
    await page.locator('.hand-cards-grid .card-chip', { hasText: '5♠' }).click();
    await page.getByTestId('deck-of-days-zone').click();
    const confirmAirBtn = page.getByRole('button', { name: /Confirm: Shuffle/i });
    await expect(confirmAirBtn).toBeEnabled();
    await confirmAirBtn.click();

    // 3. Autonomous Bot delivers Turn 1 Reading automatically -> Human sees Accept / Reject!
    await expect(page.getByTestId('accept-center-btn')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('reject-center-btn')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '02-turn1-bot-reading-advice.png'), fullPage: true });

    // 4. Pursue (Accept & Flip Center) -> Treasure (7♦) revealed -> Claim Treasure -> Finish Turn!
    await page.getByTestId('accept-center-btn').click();
    await expect(page.getByTestId('resolve-event-btn')).toContainText('Claim Treasure');
    await page.screenshot({ path: path.join(SHOT_DIR, '03-turn1-treasure-revealed.png'), fullPage: true });
    await page.getByTestId('resolve-event-btn').click();

    await expect(page.getByTestId('end-turn-btn')).toBeVisible();
    await page.getByTestId('end-turn-btn').click();

    // 5. Turn 2: Bot runs its own Elemental Prep autonomously, then prompts Human as Reader!
    const adviseBadBtn = page.getByRole('button', { name: 'Advise: BAD' });
    await expect(adviseBadBtn).toBeVisible({ timeout: 12_000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '04-turn2-human-reader-for-bot.png'), fullPage: true });
    await adviseBadBtn.click();

    // 6. Bot follows BAD advice (rejects Card 1 -> grants Human Reader Bonus!), completes Turn 2 autonomously, and returns control to Human on Turn 3!
    await expect(page.getByText('Round 2 · Turn 3')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Your Turn')).toBeVisible();

    // Verify Reader Bonus is visible and actionable on Turn 3!
    const bonusStrip = page.getByTestId('reader-bonus-strip');
    await expect(bonusStrip).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '05-turn3-reader-bonus-ready.png'), fullPage: true });

    // Activate Reader Bonus cleanly (handles whichever element Bot discarded: Fire/Air/Earth/Water)
    const activateBonusBtn = bonusStrip.locator('button', { hasText: '★ Activate' }).first();
    const bonusText = (await activateBonusBtn.textContent()) ?? '';
    await activateBonusBtn.click();

    if (bonusText.includes('Earth')) {
      await page.getByTestId('deck-of-days-zone').click();
      await page.getByRole('button', { name: /Privately Peek/i }).click();
      await expect(page.getByTestId('earth-peek-cards')).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, '06-turn3-earth-private-peek.png'), fullPage: true });
      await page.getByRole('button', { name: 'Confirm Immediate Future Order' }).click();
    } else if (bonusText.includes('Water')) {
      await page.getByTestId('veil-browser').locator('.browser-item-card.clickable').first().click();
      await page.getByRole('button', { name: /Confirm: Resurface/i }).click();
    } else {
      await page.getByTestId('deck-of-days-zone').click();
      await page.getByRole('button', { name: /Confirm:/i }).click();
    }

    // Bonus consumed cleanly; Human still retains control of Turn 3!
    await expect(page.getByText('Round 2 · Turn 3')).toBeVisible();
  });

  test('Walkthrough B (e2e-seed-7): Reject-and-Replace draws fresh card + flips Left Event into Zero-Cost Trial ("Cleared by Your Lineage")', async ({
    page
  }) => {
    await page.goto('/');

    const seedInput = page.locator('input[placeholder="custom seed"]');
    await seedInput.fill('e2e-seed-7');
    await page.getByRole('button', { name: 'New Game' }).click();

    await expect(page.getByText('Round 1 · Turn 1')).toBeVisible();
    await expect(page.getByTestId('veil-zone')).toContainText('0 cards');
    await expect(page.getByText('Your hand (3/5)')).toBeVisible();

    // Proceed straight to Reading
    await page.getByTestId('proceed-to-reading-btn').click();
    await expect(page.getByTestId('reject-center-btn')).toBeVisible({ timeout: 10_000 });

    // Reject read card -> Card 1 moves face-up to Veil, replacement Card 2 flips in Center, Left Event (2♥ Trial) flips!
    await page.getByTestId('reject-center-btn').click();

    await expect(page.getByTestId('veil-zone')).toContainText(/[1-9]\d* card/);
    await expect(page.getByText('Cleared by Your Lineage')).toBeVisible();
    await expect(page.getByTestId('resolve-event-btn')).toContainText('Claim Card (No Sacrifice Needed)');
    await expect(page.getByRole('button', { name: 'Leave for Next Player' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '07-reject-replace-zero-cost-trial.png'), fullPage: true });

    await page.getByTestId('resolve-event-btn').click();
    await expect(page.getByTestId('end-turn-btn')).toBeVisible();
  });

  test('Walkthrough C (Persistence): Save, Reload, Resume, New Game preserves existing save, and Replay Seed reproduces exact initial state', async ({
    page
  }) => {
    await page.goto('/');

    // Start deterministic eclipse-me-001 and verify initial hand (4♣, 2♦, 3♥)
    const seedInput = page.locator('input[placeholder="custom seed"]');
    await expect(seedInput).toHaveValue('eclipse-me-001');
    await expect(page.locator('.hand-cards-grid')).toContainText('4♣');
    await expect(page.locator('.hand-cards-grid')).toContainText('2♦');
    await expect(page.locator('.hand-cards-grid')).toContainText('3♥');
    await expect(page.getByTestId('veil-zone')).toContainText('0 cards');

    // Play 1 step (Proceed to Reading -> Bot advises) and click explicit Save
    await page.getByTestId('proceed-to-reading-btn').click();
    await expect(page.getByTestId('accept-center-btn')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('save-game-topbar-btn').click();
    await expect(page.getByTestId('saves-drawer-btn')).toContainText(/Saves \([1-9]\d*\)/);

    // Click New Game -> MUST start a fresh different seed at Turn 1 AND MUST NOT overwrite the existing save!
    await page.getByRole('button', { name: 'New Game' }).click();
    const newSeedValue = await seedInput.inputValue();
    expect(newSeedValue).not.toBe('eclipse-me-001');
    await expect(page.getByText('Round 1 · Turn 1')).toBeVisible();
    await expect(page.getByTestId('veil-zone')).toContainText('0 cards');
    await expect(page.getByText('Your hand (3/5)')).toBeVisible();

    // Reload browser page -> verify Resume banner appears while fresh Turn 1 loads cleanly
    await page.reload();
    await expect(page.getByTestId('resume-banner')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '08-reload-resume-banner.png'), fullPage: true });

    // Open Saved Games manager, confirm our eclipse-me-001 manual save survived New Game + reload, and explicitly Resume it!
    await page.getByTestId('saves-drawer-btn').click();
    const panel = page.getByTestId('saved-games-panel');
    await expect(panel).toBeVisible();
    const eclipseSaveRow = panel.locator('.saved-game-row', { hasText: 'eclipse-me-001' }).first();
    await expect(eclipseSaveRow).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '09-saved-games-manager.png'), fullPage: true });
    await eclipseSaveRow.getByRole('button', { name: 'Resume' }).click();

    // Restored straight back into eclipse-me-001 Reading Decision!
    await expect(seedInput).toHaveValue('eclipse-me-001');
    await expect(page.getByTestId('accept-center-btn')).toBeVisible();

    // Click ↺ Replay Seed -> reproduces exact identical Turn 1 initial state (4♣, 2♦, 3♥, Veil 0)!
    await page.getByTestId('replay-seed-btn').click();
    await expect(seedInput).toHaveValue('eclipse-me-001');
    await expect(page.getByTestId('proceed-to-reading-btn')).toBeVisible();
    await expect(page.locator('.hand-cards-grid')).toContainText('4♣');
    await expect(page.locator('.hand-cards-grid')).toContainText('2♦');
    await expect(page.locator('.hand-cards-grid')).toContainText('3♥');
    await expect(page.getByTestId('veil-zone')).toContainText('0 cards');
  });
});
