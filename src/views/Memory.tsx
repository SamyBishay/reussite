// Memory: what the app knows about the person's life, in notes they can read, edit and forget (brief §4,
// §10). Notes by kind with the profile on top, a search, a note sheet, and import and export of Markdown.
import { Rings } from '../app/Rings';
import { useState } from 'preact/hooks';
import { memory, readOnly, toast, type WithId } from '../app/store';
import { openSheet, closeSheet } from '../app/ui';
import { MEMORY_KINDS, type MemoryKind, type MemoryNote } from '../data/schema';
import { norm } from '../domain/names';
import { bundle, isMemoryIndex, mergeNotes, parseMemoryMd, toMarkdown, type MergePlan, type NoteDraft } from '../domain/memoryMd';
import { saveFile } from '../data/backup';
import { addNote, addAlias, removeAlias, addLine, editLine, forgetLine, forgetNote, renameNote, setKind, setPrivate, applyImport } from '../app/memoryActions';
import { t, type Key } from '../i18n';

const KIND_ONE: Record<MemoryKind, Key> = { profile: 'memKindProfile', person: 'memKindPerson', place: 'memKindPlace', area: 'memKindArea', topic: 'memKindTopic' };
const KIND_MANY: Record<MemoryKind, Key> = { profile: 'memGroupProfile', person: 'memGroupPerson', place: 'memGroupPlace', area: 'memGroupArea', topic: 'memGroupTopic' };

const isoToday = () => new Date().toISOString().slice(0, 10);
const input = (e: Event) => (e.target as HTMLInputElement).value;
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Whether a note answers a search: its name, aliases or any line, ignoring case and accents. */
const matches = (n: MemoryNote, q: string): boolean => {
  const want = norm(q);
  return !want || [n.name, ...n.aliases, ...n.lines.map(l => l.text)].some(s => norm(s).includes(want));
};

const copy = (text: string, done: Key) => {
  try { navigator.clipboard.writeText(text).then(() => toast(t(done)), () => toast(t('memCopyBlocked'))); } catch { toast(t('memCopyBlocked')); }
};

export function Memory() {
  const [q, setQ] = useState('');
  const all = [...memory.value.values()];
  const shown = all.filter(n => matches(n, q));
  return (
    <div data-testid="memory">
      <h2 class="sec" style="margin-top:0">{t('memoryTitle')}</h2>
      <p class="hint">{t('memIntro')}</p>
      <div class="actions">
        <button class="btn" type="button" disabled={readOnly.value} onClick={() => openSheet(<NewNote key={'mn' + Date.now()} />)} data-testid="memory-new">{t('memNew')}</button>
        <button class="btn" type="button" disabled={readOnly.value} onClick={() => openSheet(<ImportSheet key={'mi' + Date.now()} />, true)} data-testid="memory-import">{t('memImport')}</button>
        <button class="btn" type="button" onClick={() => openSheet(<ExportSheet key={'me' + Date.now()} />)} data-testid="memory-export">{t('memExport')}</button>
      </div>
      {all.length > 0 && <input type="search" value={q} placeholder={t('memSearch')} aria-label={t('memSearch')} style="margin-top:var(--s4)" onInput={e => setQ(input(e))} data-testid="memory-search" />}
      {!all.length && <div class="emptystate"><Rings /><p class="hint" data-testid="memory-empty">{t('memEmpty')}</p></div>}
      {all.length > 0 && !shown.length && <p class="hint" style="margin-top:var(--s4)">{t('memNoMatch', { q })}</p>}
      {MEMORY_KINDS.map(kind => {
        const group = shown.filter(n => n.kind === kind).sort(byName);
        if (!group.length) return null;
        return (
          <section key={kind} data-testid={'memory-' + kind}>
            <h3 class="sec">{t(KIND_MANY[kind])}</h3>
            <ul class="picklist menu notes">
              {group.map(n => (
                <li key={n.id}>
                  <button type="button" class="linklike" onClick={() => openSheet(<NoteSheet key={n.id} id={n.id} />, true)} data-testid="memory-note">
                    <b>{n.name}</b>
                    <small class="hint">{t('memLinesN', { n: n.lines.length })}{n.private && <> · <span class="tag">{t('memPrivateTag')}</span></>}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function NewNote() {
  const [name, setName] = useState('');
  const [kind, setKindState] = useState<MemoryKind>('person');
  const go = async (e: Event) => {
    e.preventDefault();
    const id = await addNote(name, kind);
    if (id) openSheet(<NoteSheet key={id} id={id} />, true);
  };
  return (
    <form data-testid="memory-new-sheet" onSubmit={go}>
      <h3>{t('memNewTitle')}</h3>
      <label class="field"><span>{t('memName')}</span>
        <input type="text" value={name} autocomplete="off" required onInput={e => setName(input(e))} data-testid="memory-new-name" />
      </label>
      <label class="field"><span>{t('memKind')}</span>
        <select value={kind} onChange={e => setKindState((e.target as HTMLSelectElement).value as MemoryKind)}>
          {MEMORY_KINDS.map(k => <option value={k}>{t(KIND_ONE[k])}</option>)}
        </select>
      </label>
      <div class="actions"><button class="btn primary" type="submit" disabled={!name.trim() || readOnly.value} data-testid="memory-create">{t('memCreate')}</button></div>
    </form>
  );
}

/** One note: its fields, its lines edited in place, and Forget. Reads the note live, so a change from sync shows. */
function NoteSheet({ id }: { id: string }) {
  const n: WithId<MemoryNote> | undefined = memory.value.get(id);
  const [alias, setAlias] = useState('');
  const [line, setLine] = useState('');
  if (!n) return <p class="hint">{t('memForgotten')}</p>;
  const off = readOnly.value;
  const addA = async (e: Event) => { e.preventDefault(); await addAlias(id, alias); setAlias(''); };
  const addL = async (e: Event) => { e.preventDefault(); await addLine(id, line); setLine(''); };
  const forgetWhole = async () => {
    if (!confirm(t('memForgetNoteConfirm', { name: n.name }))) return;
    await forgetNote(id);
    closeSheet();
    toast(t('memForgotten'));
  };
  return (
    <div data-testid="memory-sheet">
      <h3>{n.name}</h3>
      {n.description && <p class="hint">{n.description}</p>}
      <label class="field"><span>{t('memName')}</span>
        <input type="text" key={'name' + n.name} defaultValue={n.name} disabled={off} autocomplete="off" onChange={e => void renameNote(id, input(e))} data-testid="memory-name" />
      </label>
      <label class="field"><span>{t('memKind')}</span>
        <select value={n.kind} disabled={off} onChange={e => void setKind(id, (e.target as HTMLSelectElement).value as MemoryKind)} data-testid="memory-kind">
          {MEMORY_KINDS.map(k => <option value={k}>{t(KIND_ONE[k])}</option>)}
        </select>
      </label>
      <div class="field"><span>{t('memAliases')}</span>
        {n.aliases.length > 0 && (
          <div class="toggles">{n.aliases.map(a => (
            <span class="chip" data-testid="memory-alias">{a}
              <button type="button" aria-label={t('memAliasRemove', { name: a })} disabled={off} onClick={() => void removeAlias(id, a)}>×</button></span>
          ))}</div>
        )}
        <form class="addplace" onSubmit={addA}>
          <input type="text" value={alias} placeholder={t('memAliasPh')} aria-label={t('memAliasPh')} autocomplete="off" onInput={e => setAlias(input(e))} data-testid="memory-alias-input" />
          <button class="btn" type="submit" disabled={off || !alias.trim()}>{t('memAliasAdd')}</button>
        </form>
      </div>
      <label class="tog" style="margin-top:var(--s4)"><input type="checkbox" checked={n.private} disabled={off} onChange={e => void setPrivate(id, (e.target as HTMLInputElement).checked)} data-testid="memory-private" /> {t('memPrivate')}</label>
      <p class="hint">{t('memPrivateHint')}</p>

      <h4 class="sec">{t('memLines')}</h4>
      {!n.lines.length && <p class="hint">{t('memNoLines')}</p>}
      <ul class="memlines">
        {n.lines.map((l, i) => (
          <li key={l.id} data-testid="memory-line">
            <textarea key={l.id + ':' + l.text} rows={2} defaultValue={l.text} disabled={off} aria-label={t('memLineLabel', { n: i + 1 })} onChange={e => void editLine(id, l.id, input(e))} />
            <div class="memline-foot">
              {l.by === 'ai' ? <span class="tag">{t('memByAi')}</span> : <span />}
              <button class="btn small" type="button" disabled={off} aria-label={t('memForgetLine', { text: l.text })} onClick={() => void forgetLine(id, l.id)} data-testid="memory-forget-line">{t('memForget')}</button>
            </div>
          </li>
        ))}
      </ul>
      <form class="addplace" onSubmit={addL}>
        <input type="text" value={line} placeholder={t('memLinePh')} aria-label={t('memLineAdd')} autocomplete="off" onInput={e => setLine(input(e))} data-testid="memory-line-input" />
        <button class="btn" type="submit" disabled={off || !line.trim()} data-testid="memory-line-add">{t('memLineAddBtn')}</button>
      </form>

      <div class="actions">
        <button class="btn" type="button" onClick={() => copy(toMarkdown(n), 'memCopied')} data-testid="memory-copy">{t('memCopyNote')}</button>
        <button class="btn ghost" type="button" disabled={off} onClick={forgetWhole} data-testid="memory-forget-note">{t('memForgetNote')}</button>
      </div>
    </div>
  );
}

// ---------- import ----------
interface Source { name: string; text: string }

function ImportSheet() {
  const [files, setFiles] = useState<Source[]>([]);
  const [pasted, setPasted] = useState('');
  const sources = pasted.trim() ? [...files, { name: 'pasted.md', text: pasted }] : files;
  const drafts: NoteDraft[] = sources.flatMap(s => parseMemoryMd(s.name, s.text));
  const skipped = sources.filter(s => isMemoryIndex(s.name, s.text) || !parseMemoryMd(s.name, s.text).length).length;
  // Matched against what is there when the sheet is open, so the summary is what Add to Memory will write.
  const plan: MergePlan = mergeNotes([...memory.value.values()], drafts, { id: p => p + Math.random().toString(36).slice(2, 8), now: () => new Date().toISOString() });
  const c = plan.counts;
  const choose = async (e: Event) => {
    const list = [...((e.target as HTMLInputElement).files ?? [])];
    (e.target as HTMLInputElement).value = '';
    setFiles([...files, ...(await Promise.all(list.map(async f => ({ name: f.name, text: await f.text() }))))]);
  };
  const go = async () => {
    await applyImport(plan);
    closeSheet();
    toast(t('memImportDone', { notes: c.created + c.merged, lines: c.lines }));
  };
  const rows = plan.rows.slice(0, 40);
  return (
    <div data-testid="memory-import-sheet">
      <h3>{t('memImportTitle')}</h3>
      <p class="hint">{t('memImportHint')}</p>
      <div class="actions"><label class="btn">{t('memChooseFiles')}<input type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={choose} data-testid="memory-import-files" /></label></div>
      <label class="field"><span>{t('memPasteLabel')}</span>
        <textarea rows={5} value={pasted} onInput={e => setPasted((e.target as HTMLTextAreaElement).value)} data-testid="memory-import-text" />
      </label>
      {sources.length > 0 && (
        <div data-testid="memory-import-summary" style="margin-top:var(--s4)">
          <p class="hint">{t('memFilesRead', { n: sources.length })}{skipped > 0 && ' · ' + t('memFilesSkipped', { n: skipped })}</p>
          {(c.created || c.merged || c.same) ? (
            <>
              <ul class="memsum">
                {c.created > 0 && <li>{t('memSumNew', { n: c.created })}</li>}
                {c.merged > 0 && <li>{t('memSumMerged', { n: c.merged })}</li>}
                {c.same > 0 && <li>{t('memSumSame', { n: c.same })}</li>}
                <li><b>{t('memSumLines', { n: c.lines })}</b></li>
              </ul>
              <ul class="picklist menu">
                {rows.map(r => <li><span class="memrow"><b>{r.name}</b> <small class="hint">{r.status === 'new' ? t('memRowNew') + ' · ' : ''}{r.status === 'same' ? t('memRowSame') : t('memSumLines', { n: r.added })}</small></span></li>)}
              </ul>
              {plan.rows.length > rows.length && <p class="hint">{t('memRowMore', { n: plan.rows.length - rows.length })}</p>}
            </>
          ) : <p class="hint">{t('memImportNothing')}</p>}
        </div>
      )}
      <div class="actions">
        <button class="btn primary" type="button" disabled={readOnly.value || !(c.created || c.merged)} onClick={go} data-testid="memory-import-go">{t('memImportGo')}</button>
        <button class="btn ghost" type="button" onClick={closeSheet}>{t('cancel')}</button>
      </div>
    </div>
  );
}

// ---------- export ----------
function ExportSheet() {
  const [withPrivate, setWithPrivate] = useState(false);
  const all = [...memory.value.values()];
  const priv = all.filter(n => n.private).length;
  const count = withPrivate ? all.length : all.length - priv;
  const text = () => bundle(all, withPrivate);
  return (
    <div data-testid="memory-export-sheet">
      <h3>{t('memExportTitle')}</h3>
      <p class="hint">{t('memExportHint')}</p>
      {priv > 0 && <label class="tog"><input type="checkbox" checked={withPrivate} onChange={e => setWithPrivate((e.target as HTMLInputElement).checked)} data-testid="memory-export-private" /> {t('memExportPrivate', { n: priv })}</label>}
      <p class="hint" data-testid="memory-export-count">{count ? t('memExportCount', { n: count }) : t('memExportNone')}</p>
      <div class="actions">
        <button class="btn primary" type="button" disabled={!count} onClick={() => { void saveFile('reussite-memory-' + isoToday() + '.md', text(), 'text/markdown'); closeSheet(); }} data-testid="memory-export-save">{t('memExportSave')}</button>
        <button class="btn" type="button" disabled={!count} onClick={() => copy(text(), 'memExportCopied')} data-testid="memory-export-copy">{t('memExportCopy')}</button>
      </div>
    </div>
  );
}
