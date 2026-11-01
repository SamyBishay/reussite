import { test, expect, type Page } from '@playwright/test';
import { importSample, goTab, expandSettings, noSideways, openAllProjects } from './helpers';

// Declutter 2: closed decisions are folded away in Projects.
const HLC = '0000000000001:0000:seed';
const decision = (title: string, status: string, projectId: string | null) => ({
  title, projectId, taskId: null, problem: {}, options: [], status, listClosedAt: null, chosen: status === 'closed' ? 'Option A' : null, chosenId: null,
  why: '', mustBeTrue: '', falsifier: '', date: '2026-01-05', reviewOn: null, taskIds: [], newFacts: [], reviews: [], history: [],
});
async function seedDecisions(page: Page, ds: [string, ReturnType<typeof decision>][]) {
  const stamp = (id: string, f: Record<string, unknown>) => ({ id, _v: 4, _hlc: Object.fromEntries(Object.keys(f).map(k => [k, HLC])), ...f });
  const file = { format: 'reussite-backup', schema: 4, exported: new Date().toISOString(), data: { decisions: ds.map(([id, f]) => stamp(id, f)) } };
  await page.goto('/#settings'); await expandSettings(page);
  page.once('dialog', d => void d.accept());
  await page.getByTestId('data').locator('input[type=file]').first().setInputFiles({ name: 'dec.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.locator('.toast')).toContainText('Backup restored');
  await page.reload();
}

test('closed decisions are folded under “Closed (n)”, in the list and inside a project; the others are not', async ({ page }) => {
  await importSample(page);
  await seedDecisions(page, [
    ['dc1', decision('Old closed one', 'closed', null)],
    ['dc2', decision('Another closed one', 'closed', 'p1')],
    ['dd1', decision('Still drafting', 'draft', null)],
  ]);
  await goTab(page, 'projects');
  const decisions = page.getByTestId('decisions');
  // Not folded: the open one is in plain sight.
  await expect(decisions.getByRole('button', { name: 'Still drafting' })).toBeVisible();
  // Folded: the closed group is a closed <details> with its count.
  const fold = decisions.getByTestId('decisions-closed');
  await expect(fold).toContainText('Closed (2)');
  await expect(fold).toHaveJSProperty('open', false);
  await expect(decisions.getByRole('button', { name: 'Old closed one' })).toBeHidden();
  await decisions.getByTestId('decisions-closed-toggle').click();
  await expect(fold).toHaveJSProperty('open', true);
  await expect(decisions.getByRole('button', { name: 'Old closed one' })).toBeVisible();
  // Inside the project the same.
  await openAllProjects(page);
  const linked = page.locator('[data-project=p1]').getByTestId('linked-closed');
  await expect(linked).toContainText('Closed (1)');
  await expect(linked).toHaveJSProperty('open', false);
  await page.locator('[data-project=p1]').getByTestId('linked-closed-toggle').click();
  await expect(page.locator('[data-project=p1]').getByRole('button', { name: /Another closed one/ })).toBeVisible();
  await noSideways(page, 'projects with closed decisions');
});
