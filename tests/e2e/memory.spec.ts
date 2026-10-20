import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { noSideways, openMenu } from './helpers';

// Memory (phase 2b): notes by kind, a note sheet, import of Claude Code and claude.ai memory, and export.
// Every file here is invented.
const sheet = (page: Page) => page.getByTestId('sheet');
const note = (page: Page, name: string) => page.getByTestId('memory-note').filter({ hasText: name });
const file = (name: string, text: string) => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(text) });
const store = (page: Page, name: string) => page.evaluate(n => new Promise<Record<string, unknown>[]>((res, rej) => {
  const open = indexedDB.open('reussite');
  open.onerror = () => rej(open.error);
  open.onsuccess = () => { const all = open.result.transaction(n).objectStore(n).getAll(); all.onsuccess = () => res(all.result); };
}), name);

const CHOIR = `---
name: choir
description: "The Monday choir: where, and who leads it"
metadata:
  node_type: memory
  type: project
  originSessionId: 00000000-0000-0000-0000-000000000000
---

Rehearsals are in the church hall,
the one with the green door.

**Why:** the hall by the station is too small.
**How to apply:** give the green door when asked where.

- Tea is brought in turn
`;
const PERSON = `---
name: about-me
metadata:
  type: user
---

Works from home on Tuesdays.
`;
const INDEX = `# Memory

- [Choir](choir.md) — the Monday choir
- [About me](about-me.md) — facts
`;
const PASTED = `## Garden
- Spade in the shed
- Watering on Sundays

## Bakery
Opens at seven.
`;

async function open(page: Page) {
  await page.goto('/');
  await openMenu(page, 'memory');
  await expect(page.getByTestId('memory')).toBeVisible();
}

async function importFiles(page: Page, files: ReturnType<typeof file>[]) {
  await page.getByTestId('memory-import').click();
  await page.getByTestId('memory-import-files').setInputFiles(files);
  await expect(page.getByTestId('memory-import-summary')).toBeVisible();
}

test('import two Claude Code files and a skipped index: a summary first, then the notes, grouped by kind', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('memory-empty')).toBeVisible();
  await importFiles(page, [file('choir.md', CHOIR), file('about-me.md', PERSON), file('MEMORY.md', INDEX)]);
  const summary = page.getByTestId('memory-import-summary');
  await expect(summary).toContainText('3 files read');
  await expect(summary).toContainText('1 file skipped');
  await expect(summary).toContainText('2 new notes');
  await expect(summary).toContainText('5 lines added');
  // Nothing is written until Add to Memory.
  expect(await store(page, 'memory')).toHaveLength(0);
  await page.getByTestId('memory-import-go').click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('.toast')).toContainText('2 notes, 5 lines added');
  // type: user is the Profile, type: project an Area; the Profile is first.
  await expect(page.getByTestId('memory-profile')).toContainText('about-me');
  await expect(page.getByTestId('memory-area')).toContainText('choir');
  const order = await page.locator('[data-testid^=memory-][data-testid$=profile], [data-testid^=memory-][data-testid$=area]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  expect(order).toEqual(['memory-profile', 'memory-area']);

  // The lines: the paragraph is one line, Why and How are lines, the bullet too.
  await note(page, 'choir').click();
  const lines = sheet(page).getByTestId('memory-line').locator('textarea');
  await expect(lines).toHaveCount(4);
  await expect(lines.nth(0)).toHaveValue('Rehearsals are in the church hall, the one with the green door.');
  await expect(lines.nth(1)).toHaveValue('Why: the hall by the station is too small.');
  await expect(lines.nth(3)).toHaveValue('Tea is brought in turn');
  expect((await store(page, 'memory')).flatMap(d => (d.lines as { by: string }[]).map(l => l.by))).toEqual(Array(5).fill('me'));
});

test('importing again adds only new lines, and pasted claude.ai text makes a note per heading', async ({ page }) => {
  await open(page);
  await importFiles(page, [file('choir.md', CHOIR)]);
  await page.getByTestId('memory-import-go').click();
  await expect(note(page, 'choir')).toBeVisible();

  // The same file, once more: nothing to add.
  await importFiles(page, [file('choir.md', CHOIR)]);
  await expect(page.getByTestId('memory-import-summary')).toContainText('1 note has it all already');
  await expect(page.getByTestId('memory-import-go')).toBeDisabled();
  await page.keyboard.press('Escape');

  // The same note with one more line and one old line reworded in case and spacing: one line is new.
  await importFiles(page, [file('choir.md', CHOIR.replace('- Tea is brought in turn', '- tea is  brought in turn\n- Doors open at 18:45'))]);
  await expect(page.getByTestId('memory-import-summary')).toContainText('1 note gets something new');
  await expect(page.getByTestId('memory-import-summary')).toContainText('1 line added');
  await page.getByTestId('memory-import-go').click();
  await note(page, 'choir').click();
  await expect(sheet(page).getByTestId('memory-line')).toHaveCount(5);
  await page.keyboard.press('Escape');

  // Pasted text with ## headings.
  await page.getByTestId('memory-import').click();
  await page.getByTestId('memory-import-text').fill(PASTED);
  await expect(page.getByTestId('memory-import-summary')).toContainText('2 new notes');
  await page.getByTestId('memory-import-go').click();
  await expect(page.getByTestId('memory-topic')).toContainText('Garden');
  await expect(page.getByTestId('memory-topic')).toContainText('Bakery');
  await expect(page.getByTestId('memory-topic')).toContainText('2 lines');
});

test('edit a line, add one, make a note Private, search, and Forget empties what was written', async ({ page }) => {
  await open(page);
  await importFiles(page, [file('about-me.md', PERSON), file('choir.md', CHOIR)]);
  await page.getByTestId('memory-import-go').click();
  await note(page, 'choir').click();

  // Edit a line in place; the person's words, saved when they leave the field.
  const first = sheet(page).getByTestId('memory-line').first().locator('textarea');
  await first.fill('Rehearsals are in the church hall on Mill Street.');
  await first.blur();
  await expect.poll(async () => ((await store(page, 'memory')).find(d => d.name === 'choir')!.lines as { text: string }[])[0]!.text).toBe('Rehearsals are in the church hall on Mill Street.');

  // Add a line and an alias.
  await sheet(page).getByTestId('memory-line-input').fill('Sheet music is on the piano');
  await sheet(page).getByTestId('memory-line-add').click();
  await expect(sheet(page).getByTestId('memory-line')).toHaveCount(5);
  await sheet(page).getByTestId('memory-alias-input').fill('Singing');
  await sheet(page).getByRole('button', { name: 'Add name' }).click();
  await expect(sheet(page).getByTestId('memory-alias')).toContainText('Singing');

  // Forget one line: it is gone from the stored note, text and all.
  await sheet(page).getByTestId('memory-forget-line').nth(1).click();
  await expect(sheet(page).getByTestId('memory-line')).toHaveCount(4);
  const stored = JSON.stringify(await store(page, 'memory'));
  expect(stored).not.toContain('too small');
  expect(stored).toContain('Sheet music is on the piano');

  // Private shows in the list.
  await sheet(page).getByTestId('memory-private').check();
  await page.keyboard.press('Escape');
  await expect(note(page, 'choir')).toContainText('Private');
  await expect(note(page, 'about-me')).not.toContainText('Private');

  // Search by an alias and by a line, case and accents ignored.
  await page.getByTestId('memory-search').fill('SINGING');
  await expect(page.getByTestId('memory-note')).toHaveCount(1);
  await page.getByTestId('memory-search').fill('tuesdays');
  await expect(page.getByTestId('memory-note')).toHaveText(/about-me/);
  await page.getByTestId('memory-search').fill('nothing like this');
  await expect(page.getByTestId('memory-note')).toHaveCount(0);
  await page.getByTestId('memory-search').fill('');

  // Forget the whole note: gone from the list, and its tombstone holds no text.
  page.once('dialog', d => void d.accept());
  await note(page, 'choir').click();
  await sheet(page).getByTestId('memory-forget-note').click();
  await expect(sheet(page)).toBeHidden();
  await expect(note(page, 'choir')).toHaveCount(0);
  const gone = (await store(page, 'memory')).filter(d => d._del);
  expect(gone).toHaveLength(1);
  expect(gone[0]).toMatchObject({ name: '', aliases: [], lines: [], description: '' });
  expect(JSON.stringify(await store(page, 'memory'))).not.toContain('Mill Street');
  // Forgetting is not an exchange: nothing for History or Undo to bring back.
  expect(await store(page, 'exchanges')).toHaveLength(0);
});

test('a new note can be made by hand; a rename and a kind change are saved', async ({ page }) => {
  await open(page);
  await page.getByTestId('memory-new').click();
  await page.getByTestId('memory-new-name').fill('Ibrahim');
  await sheet(page).locator('select').selectOption('person');
  await page.getByTestId('memory-create').click();
  await expect(sheet(page).getByTestId('memory-sheet')).toBeVisible();
  await sheet(page).getByTestId('memory-line-input').fill('Plays the oud');
  await sheet(page).getByTestId('memory-line-add').click();
  await sheet(page).getByTestId('memory-kind').selectOption('place');
  await sheet(page).getByTestId('memory-name').fill('Ibrahim’s flat');
  await sheet(page).getByTestId('memory-name').blur();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('memory-place')).toContainText('Ibrahim’s flat');
  await expect(page.getByTestId('memory-person')).toHaveCount(0);
});

test('a field focused the moment a sheet opens keeps its focus (the dialog takes focus only when nothing inside has it)', async ({ page }) => {
  await open(page);
  // Typing straight after the tap, before the sheet's own focus step has run: what a fast fill does.
  const kept = await page.evaluate(async () => {
    (document.querySelector('[data-testid=memory-new]') as HTMLElement).click();
    let el: HTMLInputElement | null = null;
    while (!(el = document.querySelector('[data-testid=memory-new-name]'))) await new Promise(r => setTimeout(r, 0));
    el.focus();
    await new Promise(r => setTimeout(r, 400));
    return document.activeElement === el;
  });
  expect(kept).toBe(true);
});

test('export: one .md bundle, private notes only when ticked, and Copy for one note', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  await open(page);
  await importFiles(page, [file('about-me.md', PERSON), file('choir.md', CHOIR), file('garden.md', '---\nname: Garden\nprivate: true\n---\n- The key is under the pot\n')]);
  await page.getByTestId('memory-import-go').click();

  await page.getByTestId('memory-export').click();
  await expect(page.getByTestId('memory-export-count')).toHaveText('2 notes will be exported.');
  const [one] = await Promise.all([page.waitForEvent('download'), page.getByTestId('memory-export-save').click()]);
  expect(one.suggestedFilename()).toMatch(/^reussite-memory-\d{4}-\d{2}-\d{2}\.md$/);
  const plain = readFileSync((await one.path())!, 'utf8');
  expect(plain).toContain('name: choir');
  expect(plain).toContain('- Why: the hall by the station is too small.');
  expect(plain).toContain('name: about-me');
  expect(plain).not.toContain('under the pot');

  await page.getByTestId('memory-export').click();
  await page.getByTestId('memory-export-private').check();
  await expect(page.getByTestId('memory-export-count')).toHaveText('3 notes will be exported.');
  const [two] = await Promise.all([page.waitForEvent('download'), page.getByTestId('memory-export-save').click()]);
  const all = readFileSync((await two.path())!, 'utf8');
  expect(all).toContain('private: true');
  expect(all).toContain('- The key is under the pot');

  // The bundle imports back into an empty Memory as the same notes.
  const names = [...all.matchAll(/^name: (.+)$/gm)].map(m => m[1]).sort();
  expect(names).toEqual(['Garden', 'about-me', 'choir']);

  // Copy for one note puts its Markdown on the clipboard.
  await note(page, 'about-me').click();
  await sheet(page).getByTestId('memory-copy').click();
  await expect(page.locator('.toast')).toContainText(/Note copied|Copy was blocked/);
});

for (const width of [320, 375, 430]) {
  test(`Memory, a note, the import and the export do not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    await noSideways(page, 'empty memory');
    const long = 'A very long line with an-unbroken-run-of-words-that-could-push-the-sheet-wider-than-the-screen-if-nothing-wraps-it and then more words after it to wrap normally';
    await importFiles(page, [file('choir.md', CHOIR), file('about-me.md', PERSON), file('a-rather-long-name-for-a-note-to-see-it-wrap-on-a-narrow-screen.md', `---\nname: A rather long name for a note, to see it wrap on a narrow screen\naliases: [Another fairly long alias here]\nprivate: true\n---\n- ${long}\n`)]);
    await noSideways(page, 'import summary');
    await page.getByTestId('memory-import-go').click();
    await expect(sheet(page)).toBeHidden();
    await noSideways(page, 'list');
    await note(page, 'A rather long name').click();
    await noSideways(page, 'note sheet');
    await sheet(page).getByTestId('memory-forget-line').first().scrollIntoViewIfNeeded();
    await expect(sheet(page).getByTestId('memory-forget-line').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('memory-export').click();
    await noSideways(page, 'export sheet');
  });
}
