// The name of the AI the person has configured, for the command box ("Ask Claude…"). Pure: the provider and the model in, a name out.
// The Anthropic adapter is Claude. For the OpenAI-compatible adapter the model id says whose model it is, once an optional
// "vendor/" prefix (OpenRouter's way of naming) is stripped. An id nobody here knows is "your AI". No vendor is favoured: this is a lookup.
import { t } from '../i18n';
import type { AiProvider } from '../data/settings';

const BY_PREFIX: [RegExp, string][] = [
  [/^claude/, 'Claude'],
  [/^(gpt|o1|o3|o4|chatgpt)/, 'ChatGPT'],
  [/^gemini/, 'Gemini'],
  [/^mistral/, 'Mistral'],
  [/^llama/, 'Llama'],
  [/^deepseek/, 'DeepSeek'],
  [/^grok/, 'Grok'],
  [/^qwen/, 'Qwen'],
];

export function aiName(provider: AiProvider, model: string): string {
  if (provider === 'anthropic') return 'Claude';
  const id = (model.split('/').pop() ?? '').trim().toLowerCase();
  for (const [re, name] of BY_PREFIX) if (re.test(id)) return name;
  return t('aiYours');
}
