// Settings → How Réussite understands you → My own key (brief §10): provider, base URL, the two model slots, the key (device-local
// only), "Test the connection" and "Always show what's sent". A piece of that section (src/app/UnderstandSettings.tsx), not a section of its own.
import { openGuidedAi } from '../flows/guidedAi';
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { z } from 'zod';
import { settings, saveSettings, toast } from '../app/store';
import { t } from '../i18n';
import { More, countSet } from '../app/More';
import { DEFAULT_SETTINGS, type AiProvider } from '../data/settings';
import { DEFAULT_PREFERENCES } from '../domain/preferences';
import { ask, getKey, setKey, forgetSeen, spent, loadSpent, baseUnapproved, approveBase } from './ask';
import { monthTokens } from './prices';

const set = (p: Parameters<typeof saveSettings>[0]) => void saveSettings(p);
const TEST_SCHEMA = z.object({ ok: z.literal(true) });
/** The last "Test the connection" on this screen, for the status list: cleared when the provider or the key changes. */
export const keyTest = signal<{ ok: boolean; msg: string } | null>(null);

/** This month's use on this device, and the limit. */
function Spend() {
  const s = settings.value, m = spent.value;
  useEffect(() => { void loadSpent(); }, []);
  const usd = m ? (m.usd < 1 ? m.usd.toFixed(3) : m.usd.toFixed(2)) : '0';
  return (
    <div data-testid="ai-spend" style="margin-top:var(--s4)"><p class="field-label">{t('aiSpendTitle')}</p>
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

/** The person's lines for an AI (docs/ai/preferences.md): in every request. Used here and in onboarding. */
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

/**
 * My own key: the provider, the key and its test, the guided set-up, and under More the rest. `data-testid="ai-settings"`, which the status list
 * and Next steps scroll to. Choosing no provider is "On this device", the first choice of the section above it.
 */
export function AiKeyPanel() {
  const s = settings.value;
  const p = s.aiProvider;
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const test = keyTest.value;
  useEffect(() => { keyTest.value = null; if (p === 'none') setHasKey(false); }, [p]);
  const onHas = (b: boolean) => { if (b !== hasKey) keyTest.value = null; setHasKey(b); };
  const runTest = async () => {
    setBusy(true); keyTest.value = null;
    const r = await ask('test', 'quick', 'Reply with exactly this JSON and nothing else: {"ok": true}', 'Connection test.', TEST_SCHEMA, { noPreview: true, maxTokens: 2000 });
    setBusy(false);
    keyTest.value = { ok: r.ok, msg: r.ok ? t('aiTestOk', { model: s.aiModels[p as Exclude<AiProvider, 'none'>].quick }) : r.message };
  };
  const models = p === 'none' ? null : s.aiModels[p];
  const setModel = (slot: 'quick' | 'thinking', v: string) => {
    if (p === 'none') return;
    set({ aiModels: { ...s.aiModels, [p]: { ...s.aiModels[p], [slot]: v.trim() || DEFAULT_SETTINGS.aiModels[p][slot] } } });
  };
  return (
    <div class="uway-body" data-testid="ai-settings">
      <div class="field"><span>{t('aiProvider')}</span>
        <div class="seg" role="group" aria-label={t('aiProvider')} style="flex-wrap:wrap">
          {([['openai', 'aiOpenAI'], ['anthropic', 'aiAnthropic']] as const).map(([v, k]) =>
            <button type="button" aria-pressed={p === v} onClick={() => set({ aiProvider: v })} data-testid={'ai-' + v}>{t(k)}</button>)}
        </div>
      </div>
      {baseUnapproved() && (
        <div class="err" role="alert" data-testid="ai-base-unapproved">
          <p>{t('aiBaseUnapproved', { url: s.aiBaseUrl })}</p>
          <button class="btn small" type="button" onClick={() => void approveBase()} data-testid="ai-base-approve">{t('aiBaseApprove')}</button>
        </div>
      )}
      {models && (
        <>
          {p !== 'none' && <KeyField p={p} onHas={onHas} />}
          <div class="actions">
            <button class="btn" type="button" disabled={!hasKey || busy} onClick={runTest} data-testid="ai-test">{busy ? t('aiTesting') : t('aiTest')}</button>
          </div>
          {test && !busy && <p class={test.ok ? 'hint' : 'err'} role="status" data-testid="ai-test-result" style="margin-top:var(--s2)">{test.msg}</p>}
        </>
      )}
      <div class="actions"><button class="btn ghost small" type="button" onClick={() => void openGuidedAi('key')} data-testid="ai-guided">{t('aiGuided')}</button></div>
      <More n={countSet(models && (models.quick !== DEFAULT_SETTINGS.aiModels[p as Exclude<AiProvider, 'none'>].quick || models.thinking !== DEFAULT_SETTINGS.aiModels[p as Exclude<AiProvider, 'none'>].thinking), p === 'openai' && s.aiBaseUrl !== DEFAULT_SETTINGS.aiBaseUrl, s.aiPreferences !== DEFAULT_SETTINGS.aiPreferences, s.aiAlwaysShow, s.aiMonthlyCap)} testid="ai-more">
        {p === 'openai' && (
          <label class="field"><span>{t('aiBaseUrl')}</span>
            <input type="url" inputMode="url" value={s.aiBaseUrl} onChange={e => { set({ aiBaseUrl: (e.target as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.aiBaseUrl }); void approveBase(); }} data-testid="ai-base" />
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
          </>
        )}
        <PreferencesEditor value={s.aiPreferences} onSave={v => set({ aiPreferences: v })} />
        <div class="toggles" style="margin-top:var(--s4)">
          <label class="tog"><input type="checkbox" checked={s.aiAlwaysShow} onChange={e => set({ aiAlwaysShow: (e.target as HTMLInputElement).checked })} /> {t('aiAlwaysShow')}</label>
        </div>
        <p class="hint">{t('aiAlwaysShowHint')} <button class="linklike" type="button" onClick={() => void forgetSeen().then(() => toast(t('aiSeenReset')))}>{t('aiSeenResetBtn')}</button></p>
        {p !== 'none' && <Spend />}
      </More>
    </div>
  );
}
