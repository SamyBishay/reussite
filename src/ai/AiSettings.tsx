// Settings → AI (brief §10): provider, base URL, the two model slots, the key (device-local
// only), "Test the connection" and "Always show what's sent".
import { useEffect, useRef, useState } from 'preact/hooks';
import { z } from 'zod';
import { settings, saveSettings, toast } from '../app/store';
import { t } from '../i18n';
import { DEFAULT_SETTINGS, type AiProvider } from '../data/settings';
import { DEFAULT_PREFERENCES } from '../domain/preferences';
import { ask, getKey, setKey, forgetSeen, spent, loadSpent } from './ask';
import { monthTokens } from './prices';
import { dropMemoryLine } from './context';
import { dropBase, syncOn } from '../app/sync';

const set = (p: Parameters<typeof saveSettings>[0]) => void saveSettings(p);
const TEST_SCHEMA = z.object({ ok: z.literal(true) });

/** The drop address and the sentence to paste once into an AI (the one-tap link, docs/CHANGESET.md). */
function DropAddress() {
  const base = dropBase.value;
  const sentence = base ? dropMemoryLine(base) : '';
  const copy = () => navigator.clipboard?.writeText(sentence).then(() => toast(t('dropCopied')), () => undefined);
  return (
    <div class="field" data-testid="drop-section"><span>{t('dropSection')}</span>
      <p class="hint" style="margin:0">{t('dropHint')}</p>
      {!syncOn.value ? <p class="hint" data-testid="drop-needs-sync">{t('dropNeedsSync')}</p>
        : !base ? <p class="hint">{t('dropUnsupported')}</p>
        : (
          <>
            <p class="field-label">{t('dropAddress')}</p>
            <p class="urlbox mono" data-testid="drop-address">{base}</p>
            <small class="hint">{t('dropAddressHint')}</small>
            <p class="field-label">{t('dropPaste')}</p>
            <pre class="ai-pre" data-testid="drop-sentence">{sentence}</pre>
            <div class="actions"><button class="btn" type="button" onClick={copy} data-testid="drop-copy">{t('dropCopy')}</button></div>
          </>
        )}
    </div>
  );
}

/** This month's use on this device, and the limit. */
function Spend() {
  const s = settings.value, m = spent.value;
  useEffect(() => { void loadSpent(); }, []);
  const usd = m ? (m.usd < 1 ? m.usd.toFixed(3) : m.usd.toFixed(2)) : '0';
  return (
    <div data-testid="ai-spend" style="margin-top:14px"><p class="field-label">{t('aiSpendTitle')}</p>
      <p class="hint" style="margin:0" data-testid="ai-spend-line">
        {m && m.calls ? t('aiSpendTokens', { n: m.calls, tokens: monthTokens(m).toLocaleString() }) : t('aiSpendNone')}
        {m && m.priced ? ' ' + t('aiSpendUsd', { usd: '$' + usd }) : ''}
      </p>
      {m && m.calls > m.priced && m.priced > 0 && <small class="hint">{t('aiSpendPartial')}</small>}
      <label class="field"><span>{t('aiCapLabel')}</span>
        <input type="number" inputMode="decimal" min="0" step="0.5" value={s.aiMonthlyCap ?? ''} placeholder={t('aiCapPh')} data-testid="ai-cap"
          onChange={e => { const v = parseFloat((e.target as HTMLInputElement).value); set({ aiMonthlyCap: v > 0 ? v : null }); }} />
        <small class="hint">{t('aiCapHint')}</small>
      </label>
      <label class="field"><span>{t('aiMemBudget')}</span>
        <input type="number" inputMode="numeric" min="0" step="500" value={s.memoryBudget} data-testid="ai-membudget"
          onChange={e => { const v = parseInt((e.target as HTMLInputElement).value, 10); set({ memoryBudget: v >= 0 ? v : DEFAULT_SETTINGS.memoryBudget }); }} />
        <small class="hint">{t('aiMemBudgetHint')}</small>
      </label>
    </div>
  );
}

/** The key for a provider: device-local only. Used here and in onboarding. */
export function KeyField({ p, onHas }: { p: Exclude<AiProvider, 'none'>; onHas?: (has: boolean) => void }) {
  const [hasKey, setHasKey] = useState(false);
  const [draft, setDraft] = useState('');
  const has = (b: boolean) => { setHasKey(b); onHas?.(b); };
  // A typed key belongs to its provider: switching providers clears it (not on the first run, when a fast typist may already have started).
  const shown = useRef(p);
  useEffect(() => { if (shown.current !== p) { shown.current = p; setDraft(''); } void getKey(p).then(k => has(!!k)); }, [p]);
  const save = async (e: Event) => {
    e.preventDefault();
    if (!draft.trim()) return;
    await setKey(p, draft);
    setDraft(''); has(true);
    toast(t('aiKeySaved'));
  };
  return (
    <>
      <form class="field" onSubmit={save}><span>{t('aiKey')}</span>
        <div class="addplace">
          <input type="password" value={draft} placeholder={hasKey ? t('aiKeyReplace') : t('aiKeyPh')} aria-label={t('aiKey')} autocomplete="off" onInput={e => setDraft((e.target as HTMLInputElement).value)} data-testid="ai-key" />
          <button class="btn" type="submit" disabled={!draft.trim()} data-testid="ai-key-save">{t('aiKeySave')}</button>
        </div>
        <small class="hint">{hasKey ? t('aiKeyStored') : t('aiKeyNone')} {t('aiKeyLocal')}</small>
      </form>
      {hasKey && <div class="actions"><button class="btn ghost" type="button" onClick={async () => { await setKey(p, ''); has(false); }}>{t('aiKeyRemove')}</button></div>}
    </>
  );
}

/** The person's lines for an AI (docs/ai/preferences.md): in every request and pack. Used here and in onboarding. */
export function PreferencesEditor({ value, onSave, testid = 'ai-prefs' }: { value: string; onSave: (v: string) => void; testid?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div class="field" data-testid={testid + '-field'}><span>{t('aiPrefsTitle')}</span>
      <p class="hint" style="margin:0">{t('aiPrefsHint')}</p>
      <textarea rows={8} value={text} aria-label={t('aiPrefsTitle')} data-testid={testid} spellcheck={false}
        onInput={e => setText((e.target as HTMLTextAreaElement).value)} onChange={e => onSave((e.target as HTMLTextAreaElement).value)} />
      <div class="actions"><button class="btn small ghost" type="button" onClick={() => { setText(DEFAULT_PREFERENCES); onSave(DEFAULT_PREFERENCES); toast(t('aiPrefsReset')); }} data-testid={testid + '-reset'}>{t('aiPrefsResetBtn')}</button></div>
    </div>
  );
}

export function AiSettings() {
  const s = settings.value;
  const p = s.aiProvider;
  const [hasKey, setHasKey] = useState(false);
  const [test, setTest] = useState<{ busy: boolean; msg: string; ok: boolean } | null>(null);
  useEffect(() => { setTest(null); if (p === 'none') setHasKey(false); }, [p]);
  const runTest = async () => {
    setTest({ busy: true, msg: '', ok: false });
    const r = await ask('test', 'quick', 'Reply with exactly this JSON and nothing else: {"ok": true}', 'Connection test.', TEST_SCHEMA, { noPreview: true, maxTokens: 2000 });
    setTest({ busy: false, ok: r.ok, msg: r.ok ? t('aiTestOk', { model: s.aiModels[p as Exclude<AiProvider, 'none'>].quick }) : r.message });
  };
  const models = p === 'none' ? null : s.aiModels[p];
  const setModel = (slot: 'quick' | 'thinking', v: string) => {
    if (p === 'none') return;
    set({ aiModels: { ...s.aiModels, [p]: { ...s.aiModels[p], [slot]: v.trim() || DEFAULT_SETTINGS.aiModels[p][slot] } } });
  };
  return (
    <section class="set" data-testid="ai-settings">
      <h2>{t('aiSection')}</h2>
      <p class="hint">{t('aiIntro')}</p>
      <div class="field"><span>{t('aiProvider')}</span>
        <div class="seg" role="group" aria-label={t('aiProvider')} style="flex-wrap:wrap">
          {([['none', 'aiNone'], ['openai', 'aiOpenAI'], ['anthropic', 'aiAnthropic']] as const).map(([v, k]) =>
            <button type="button" aria-pressed={p === v} onClick={() => set({ aiProvider: v })} data-testid={'ai-' + v}>{t(k)}</button>)}
        </div>
      </div>
      {p === 'openai' && (
        <label class="field"><span>{t('aiBaseUrl')}</span>
          <input type="url" inputMode="url" value={s.aiBaseUrl} onChange={e => set({ aiBaseUrl: (e.target as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.aiBaseUrl })} data-testid="ai-base" />
          <small class="hint">{t('aiBaseUrlHint')}</small>
        </label>
      )}
      {models && (
        <>
          <div class="row2">
            <label class="field"><span>{t('aiQuick')}</span><input type="text" value={models.quick} onChange={e => setModel('quick', (e.target as HTMLInputElement).value)} autocomplete="off" spellcheck={false} /></label>
            <label class="field"><span>{t('aiThinking')}</span><input type="text" value={models.thinking} onChange={e => setModel('thinking', (e.target as HTMLInputElement).value)} autocomplete="off" spellcheck={false} /></label>
          </div>
          <p class="hint">{t('aiModelsHint')}</p>
          {p !== 'none' && <KeyField p={p} onHas={setHasKey} />}
          <div class="actions">
            <button class="btn" type="button" disabled={!hasKey || test?.busy} onClick={runTest} data-testid="ai-test">{test?.busy ? t('aiTesting') : t('aiTest')}</button>
          </div>
          {test && !test.busy && <p class={test.ok ? 'hint' : 'err'} role="status" data-testid="ai-test-result" style="margin-top:8px">{test.msg}</p>}
        </>
      )}
      <PreferencesEditor value={s.aiPreferences} onSave={v => set({ aiPreferences: v })} />
      <div class="toggles" style="margin-top:14px">
        <label class="tog"><input type="checkbox" checked={s.aiAlwaysShow} onChange={e => set({ aiAlwaysShow: (e.target as HTMLInputElement).checked })} /> {t('aiAlwaysShow')}</label>
      </div>
      <p class="hint">{t('aiAlwaysShowHint')} <button class="linklike" type="button" onClick={() => void forgetSeen().then(() => toast(t('aiSeenReset')))}>{t('aiSeenResetBtn')}</button></p>
      {p !== 'none' && <Spend />}
      <DropAddress />
    </section>
  );
}
