import { describe, expect, it } from 'vitest';
import { normNote } from '../data/normalize';
import type { MemoryNote } from '../data/schema';
import { bundle, isMemoryIndex, mergeNotes, parseMemoryMd, toMarkdown, type Gen } from './memoryMd';

let n = 0;
const gen: Gen = { id: p => p + ++n, now: () => '2026-10-20T10:00:00.000Z' };
const note = (name: string, extra: Record<string, unknown> = {}, ...lines: string[]): MemoryNote & { id: string } =>
  ({ ...normNote({ name, lines: lines.map((text, i) => ({ id: 'e' + i, text, at: '2026-10-01T10:00:00Z', by: 'ai' })), ...extra }), id: 'n' + n++ });

// Invented files in the shape Claude Code writes: nested metadata, prose paragraphs, Why / How lines, [[links]].
const CODE_FILE = `---
name: bike-repairs
description: "Where the bike gets fixed: the shop's name, and what it costs"
metadata:
  node_type: memory
  type: reference
  originSessionId: 00000000-0000-0000-0000-000000000000
  modified: 2026-10-09T16:32:57.433Z
---

The shop on Mill Street fixes
punctures while you wait, usually
within twenty minutes.

**Why:** the one near the station has a queue on weekends.
**How to apply:** suggest Mill Street first, see [[bike-lights]].

- Closed on Mondays
- Cash only for jobs under 20 euros
`;
const USER_FILE = `---
name: about-the-person
description: Short facts about the owner
metadata:
  type: user
---

Works from home on Tuesdays and Thursdays.
`;
const INDEX = `# Memory index

- [Bike repairs](bike-repairs.md) — where the bike gets fixed
- [About the person](about-the-person.md) — short facts
`;
const CLAUDE_AI = `# What I know about you

Prefers short answers.

## About me
- Lives in a small flat
- Speaks two languages

## Garden
The allotment is at the end of Pine Road.
Plots are watered on Sundays.

### Tools
- Spade in the shed

## Empty section
`;

describe('parseMemoryMd', () => {
  it('reads a Claude Code file: nested metadata type, a paragraph is one line, bullets are lines', () => {
    const [d, ...rest] = parseMemoryMd('bike-repairs.md', CODE_FILE);
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ name: 'bike-repairs', kind: 'topic', aliases: [], private: false, description: "Where the bike gets fixed: the shop's name, and what it costs" });
    expect(d!.lines).toEqual([
      'The shop on Mill Street fixes punctures while you wait, usually within twenty minutes.',
      'Why: the one near the station has a queue on weekends.',
      'How to apply: suggest Mill Street first, see bike-lights.',
      'Closed on Mondays',
      'Cash only for jobs under 20 euros',
    ]);
  });
  it('maps type: user to the profile and the other Claude Code types to a sensible kind', () => {
    expect(parseMemoryMd('a.md', USER_FILE)[0]!.kind).toBe('profile');
    const kind = (type: string) => parseMemoryMd('a.md', `---\nname: x\nmetadata:\n  type: ${type}\n---\nA line.\n`)[0]!.kind;
    expect([kind('user'), kind('feedback'), kind('project'), kind('reference'), kind('person'), kind('place'), kind('wat')])
      .toEqual(['profile', 'topic', 'area', 'topic', 'person', 'place', 'topic']);
  });
  it('reads kind, aliases (inline or block), private and quoted values from top-level frontmatter', () => {
    const [a] = parseMemoryMd('x.md', `---\nname: "Dr. Okafor: GP"\nkind: person\naliases: [Doc, "Okafor, A."]\nprivate: true\n---\n- Sees patients on Fridays\n`);
    expect(a).toMatchObject({ name: 'Dr. Okafor: GP', kind: 'person', aliases: ['Doc', 'Okafor, A.'], private: true, lines: ['Sees patients on Fridays'] });
    const [b] = parseMemoryMd('x.md', `---\nname: Ibra\naliases:\n  - Ibrahim\n  - 'Brahim''s'\n---\n- Likes tea\n`);
    expect(b!.aliases).toEqual(['Ibrahim', "Brahim's"]);
  });
  it('names a frontmatter file without a name after its # heading, else the file', () => {
    expect(parseMemoryMd('x.md', `---\ndescription: d\n---\n# Pine Road\n- Quiet\n`)[0]!.name).toBe('Pine Road');
    expect(parseMemoryMd('pine-road_notes.md', `---\ndescription: d\n---\n- Quiet\n`)[0]!.name).toBe('Pine road notes');
  });
  it('splits a file without frontmatter at its ## headings (claude.ai), with the preface as a note of its own', () => {
    const drafts = parseMemoryMd('memory.txt', CLAUDE_AI);
    expect(drafts.map(d => [d.name, d.kind, d.lines])).toEqual([
      ['What I know about you', 'topic', ['Prefers short answers.']],
      ['About me', 'profile', ['Lives in a small flat', 'Speaks two languages']],
      ['Garden', 'topic', ['The allotment is at the end of Pine Road. Plots are watered on Sundays.', 'Spade in the shed']],
    ]);
  });
  it('makes one note of a file with no frontmatter and no ## headings, named by its # title or the file', () => {
    expect(parseMemoryMd('x.md', '# Bakery\nOpens at seven.\n').map(d => [d.name, d.lines])).toEqual([['Bakery', ['Opens at seven.']]]);
    expect(parseMemoryMd('the-bakery.md', 'Opens at seven.\n\nCloses at noon.').map(d => [d.name, d.lines])).toEqual([['The bakery', ['Opens at seven.', 'Closes at noon.']]]);
    expect(parseMemoryMd('x.md', '   \n')).toEqual([]);
  });
  it('skips a MEMORY.md that only lists links, but reads one that holds notes', () => {
    expect(isMemoryIndex('memory/MEMORY.md', INDEX)).toBe(true);
    expect(parseMemoryMd('MEMORY.md', INDEX)).toEqual([]);
    expect(isMemoryIndex('notes.md', INDEX)).toBe(false);
    expect(parseMemoryMd('MEMORY.md', '# Memory\n\nLikes quiet mornings.\n').map(d => d.lines)).toEqual([['Likes quiet mornings.']]);
  });
  it('copes with CRLF, a byte-order mark and an unterminated frontmatter', () => {
    const [d] = parseMemoryMd('x.md', '﻿---\r\nname: Win\r\n---\r\n- One\r\n- Two\r\n');
    expect(d).toMatchObject({ name: 'Win', lines: ['One', 'Two'] });
    expect(parseMemoryMd('x.md', '---\nname: Broken\nA line.\n')[0]!.lines.join(' ')).toContain('A line.');
  });
});

describe('mergeNotes', () => {
  const draft = (name: string, lines: string[], extra: Record<string, unknown> = {}) => ({ name, kind: 'topic' as const, aliases: [], private: false, lines, ...extra });

  it('makes new notes with lines by me, and counts them', () => {
    const plan = mergeNotes([], [draft('Garden', ['Spade in the shed', 'Watering on Sundays'], { kind: 'area' })], gen);
    expect(plan.counts).toEqual({ created: 1, merged: 0, same: 0, lines: 2 });
    expect(plan.creates[0]).toMatchObject({ name: 'Garden', kind: 'area', private: false, updated: gen.now() });
    expect(plan.creates[0]!.lines.map(l => [l.text, l.by])).toEqual([['Spade in the shed', 'me'], ['Watering on Sundays', 'me']]);
    expect(new Set(plan.creates[0]!.lines.map(l => l.id)).size).toBe(2);
  });
  it('matches by name or alias (accents, case, punctuation ignored) and adds only lines not there yet, after the old ones', () => {
    const ib = note('Ibrahim', { kind: 'person', aliases: ['Ibra'] }, 'Likes tea', 'Plays the oud');
    const plan = mergeNotes([ib], [draft('IBRA', ['likes  TEA.', 'Moved to Lyon', 'moved to lyon'])], gen);
    expect(plan.creates).toEqual([]);
    expect(plan.counts).toEqual({ created: 0, merged: 1, same: 0, lines: 1 });
    const patch = plan.updates[0]!.patch;
    expect(plan.updates[0]!.id).toBe(ib.id);
    expect(patch.lines!.map(l => [l.id, l.text, l.by])).toEqual([['e0', 'Likes tea', 'ai'], ['e1', 'Plays the oud', 'ai'], [expect.any(String), 'Moved to Lyon', 'me']]);
    expect(patch.aliases).toBeUndefined();
  });
  it('never replaces: an existing note keeps its kind, name, privacy and description; the draft only adds', () => {
    const base = note('Choir', { kind: 'topic', description: 'Mine' }, 'Mondays at seven');
    const plan = mergeNotes([base], [draft('Choir', ['Mondays at seven'], { kind: 'area', description: 'Theirs', aliases: ['Singing'] })], gen);
    expect(plan.updates[0]!.patch).toEqual({ updated: gen.now(), aliases: ['Singing'] });
    expect(plan.rows).toEqual([{ name: 'Choir', status: 'merged', added: 0 }]);
  });
  it('reports a note that has it all already as unchanged and writes nothing', () => {
    const plan = mergeNotes([note('Choir', {}, 'Mondays at seven')], [draft('choir', ['Mondays at seven'])], gen);
    expect(plan.updates).toEqual([]);
    expect(plan.counts).toEqual({ created: 0, merged: 0, same: 1, lines: 0 });
  });
  it('adds a description only when there is none, and makes a note private if either side was', () => {
    const plan = mergeNotes([note('Choir', {}, 'x')], [draft('Choir', [], { description: 'A group', private: true })], gen);
    expect(plan.updates[0]!.patch).toMatchObject({ description: 'A group', private: true });
    const kept = mergeNotes([note('Bank', { private: true }, 'x')], [draft('Bank', ['y'])], gen);
    expect(kept.updates[0]!.patch.private).toBeUndefined();
  });
  it('joins drafts for one subject in the same import and drops repeated lines', () => {
    const plan = mergeNotes([], [draft('Garden', ['A', 'B']), draft('garden', ['b', 'C'], { aliases: ['Allotment'] }), draft('Pine Road', ['D'])], gen);
    expect(plan.creates.map(c => [c.name, c.aliases, c.lines.map(l => l.text)])).toEqual([['Garden', ['Allotment'], ['A', 'B', 'C']], ['Pine Road', [], ['D']]]);
    expect(plan.counts).toEqual({ created: 2, merged: 0, same: 0, lines: 4 });
  });
  it('is a no-op the second time', () => {
    const drafts = [CODE_FILE, USER_FILE, CLAUDE_AI].flatMap(f => parseMemoryMd('f.md', f));
    const first = mergeNotes([], drafts, gen);
    const stored = first.creates.map((c, i) => ({ ...c, id: 'm' + i }));
    const again = mergeNotes(stored, drafts, gen);
    expect(again.counts).toEqual({ created: 0, merged: 0, same: stored.length, lines: 0 });
  });
});

describe('export', () => {
  const full = (name: string, extra: Record<string, unknown>, ...lines: string[]) => note(name, extra, ...lines);

  it('writes frontmatter and one bullet per line, quoting only what needs it', () => {
    const md = toMarkdown(full('Dr. Okafor: GP', { kind: 'person', aliases: ['Doc', 'Okafor, A.', 'true'], description: 'Family doctor' }, 'Sees patients on Fridays', 'Two\nlines'));
    expect(md).toBe(['---', 'name: "Dr. Okafor: GP"', 'description: Family doctor', 'kind: person', 'aliases:', '  - Doc', '  - Okafor, A.', '  - "true"', '---', '', '- Sees patients on Fridays', '- Two lines', ''].join('\n'));
  });
  it('leaves private notes out unless asked, profile first', () => {
    const notes = [full('Zed', { kind: 'topic' }, 'z'), full('Bank', { kind: 'topic', private: true }, 'secret'), full('Me', { kind: 'profile' }, 'm'), full('Amy', { kind: 'person' }, 'a')];
    const names = (md: string) => parseMemoryMd('b.md', md).map(d => d.name);
    expect(names(bundle(notes))).toEqual(['Me', 'Amy', 'Zed']);
    expect(bundle(notes)).not.toContain('secret');
    expect(names(bundle(notes, true))).toEqual(['Me', 'Amy', 'Bank', 'Zed']);
  });
  it('round-trips: a bundle read back and merged into nothing gives the same notes', () => {
    const notes = [
      full('Ibrahim', { kind: 'person', aliases: ['Ibra', 'Brahim, B.'], description: 'A friend: from the choir' }, 'Likes tea', 'Has a "red" bike', '# not a heading', '- starts with a dash'),
      full('Home', { kind: 'place', private: true }, 'Third floor'),
      full('Me', { kind: 'profile' }, 'Works on Tuesdays'),
    ];
    const back = mergeNotes([], parseMemoryMd('bundle.md', bundle(notes, true)), gen).creates;
    expect(back.map(b => b.name).sort()).toEqual(['Home', 'Ibrahim', 'Me']);
    for (const b of back) {
      const o = notes.find(x => x.name === b.name)!;
      expect({ kind: b.kind, aliases: b.aliases, private: b.private, description: b.description, lines: b.lines.map(l => l.text) })
        .toEqual({ kind: o.kind, aliases: o.aliases, private: o.private, description: o.description, lines: o.lines.map(l => l.text) });
    }
  });
  it('a body line that looks like a rule survives inside a bundle', () => {
    const md = bundle([full('A', {}, '---', 'one'), full('B', {}, 'two')]);
    expect(parseMemoryMd('b.md', md).map(d => [d.name, d.lines])).toEqual([['A', ['---', 'one']], ['B', ['two']]]);
  });
});
