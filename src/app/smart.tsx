// The SMART goal editor (brief §5, Projects; METHOD rule 9): five fields plus the one-sentence
// goal, with a short hint per letter. A goal an AI proposed shows "proposed" until confirmed or edited.
import { projects } from './store';
import { patchProject } from './actions';
import { t, type Key } from '../i18n';
import type { Smart } from '../data/schema';

const LETTERS: [keyof Smart, Key, Key][] = [
  ['specific', 'smartS', 'smartSHint'],
  ['measurable', 'smartM', 'smartMHint'],
  ['attainable', 'smartA', 'smartAHint'],
  ['relevant', 'smartR', 'smartRHint'],
  ['dated', 'smartT', 'smartTHint'],
];
export const EMPTY_SMART: Smart = { specific: '', measurable: '', attainable: '', relevant: '', dated: '' };
export const smartFilled = (s: Smart | null | undefined) => LETTERS.filter(([k]) => s?.[k]?.trim()).length;

export function SmartEditor({ projectId }: { projectId: string }) {
  const p = projects.value.get(projectId);
  if (!p) return null;
  const smart = { ...EMPTY_SMART, ...(p.smart ?? {}) };
  const proposed = p.goalBy === 'ai' || p.smartBy === 'ai';
  const set = (k: keyof Smart, v: string) => void patchProject(projectId, { smart: { ...smart, [k]: v }, smartBy: 'me' });
  return (
    <div class="smart" data-testid="smart">
      <label class="field"><span>{t('goalSentence')}{proposed && <span class="proposed" title={t('proposedHint')}>{t('proposed')}</span>}</span>
        <input type="text" defaultValue={p.goal ?? ''} placeholder={t('goalPh')} onChange={e => void patchProject(projectId, { goal: (e.target as HTMLInputElement).value.trim() || null, goalBy: 'me' })} />
      </label>
      {LETTERS.map(([k, label, hint]) => (
        <label class="field"><span><b class="letter">{t(label).slice(0, 1)}</b> {t(label)} <small class="muted">{t(hint)}</small></span>
          <input type="text" defaultValue={smart[k]} onChange={e => set(k, (e.target as HTMLInputElement).value.trim())} />
        </label>
      ))}
      {proposed && <div class="actions"><button class="btn small" type="button" onClick={() => void patchProject(projectId, { goalBy: 'me', smartBy: 'me' })}>{t('confirm')}</button></div>}
    </div>
  );
}
