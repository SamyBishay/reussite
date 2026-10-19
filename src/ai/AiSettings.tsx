// Settings → AI (brief §10): provider, base URL, the two model slots, the key (device-local
// only), "Test the connection" and "Always show what's sent".
import { useEffect, useState } from 'preact/hooks';
import { z } from 'zod';
import { settings, saveSettings, toast } from '../app/store';
import { t } from '../i18n';
import { DEFAULT_SETTINGS, type AiProvider } from '../data/settings';
import { ask, getKey, setKey, forgetSeen } from './ask';
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

export function AiSettings() {
  const s = settings.value;
  const p = s.aiProvider;
  const [hasKey, setHasKey] = useState(false);
  const [draft, setDraft] = useState('');
  const [test, setTest] = useState<{ busy: boolean; msg: string; ok: boolean } | null>(null);
  useEffect(() => { setTest(null); if (p !== 'none') void getKey(p).then(k => setHasKey(!!k)); }, [p]);
  const saveKey = async (e: Event) => {
    e.preventDefault();
    if (p === 'none' || !draft.trim()) return;
    await setKey(p, draft);
    setDraft(''); setHasKey(true);
    toast(t('aiKeySaved'));
  };
  const removeKey = async () => { if (p === 'none') return; await setKey(p, ''); setHasKey(false); };
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
          <form class="field" onSubmit={saveKey}><span>{t('aiKey')}</span>
            <div class="addplace">
              <input type="password" value={draft} placeholder={hasKey ? t('aiKeyReplace') : t('aiKeyPh')} aria-label={t('aiKey')} autocomplete="off" onInput={e => setDraft((e.target as HTMLInputElement).value)} data-testid="ai-key" />
              <button class="btn" type="submit" disabled={!draft.trim()} data-testid="ai-key-save">{t('aiKeySave')}</button>
            </div>
            <small class="hint">{hasKey ? t('aiKeyStored') : t('aiKeyNone')} {t('aiKeyLocal')}</small>
          </form>
          <div class="actions">
            <button class="btn" type="button" disabled={!hasKey || test?.busy} onClick={runTest} data-testid="ai-test">{test?.busy ? t('aiTesting') : t('aiTest')}</button>
            {hasKey && <button class="btn ghost" type="button" onClick={removeKey}>{t('aiKeyRemove')}</button>}
          </div>
          {test && !test.busy && <p class={test.ok ? 'hint' : 'err'} role="status" data-testid="ai-test-result" style="margin-top:8px">{test.msg}</p>}
        </>
      )}
      <div class="toggles" style="margin-top:14px">
        <label class="tog"><input type="checkbox" checked={s.aiAlwaysShow} onChange={e => set({ aiAlwaysShow: (e.target as HTMLInputElement).checked })} /> {t('aiAlwaysShow')}</label>
      </div>
      <p class="hint">{t('aiAlwaysShowHint')} <button class="linklike" type="button" onClick={() => void forgetSeen().then(() => toast(t('aiSeenReset')))}>{t('aiSeenResetBtn')}</button></p>
      <DropAddress />
    </section>
  );
}
