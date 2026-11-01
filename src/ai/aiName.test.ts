import { describe, expect, it } from 'vitest';
import { aiName } from './aiName';
import { DEFAULT_SETTINGS } from '../data/settings';

describe('the name of the configured AI', () => {
  it('the Anthropic adapter is Claude, whatever the model id', () => {
    expect(aiName('anthropic', 'claude-haiku-5-5')).toBe('Claude');
    expect(aiName('anthropic', 'anything')).toBe('Claude');
  });
  it('an OpenAI-compatible model is named by its id, with or without a vendor/ prefix', () => {
    expect(aiName('openai', 'anthropic/claude-haiku-5.5')).toBe('Claude');
    expect(aiName('openai', 'gpt-4.1-mini')).toBe('ChatGPT');
    expect(aiName('openai', 'openai/o3-mini')).toBe('ChatGPT');
    expect(aiName('openai', 'o4-mini')).toBe('ChatGPT');
    expect(aiName('openai', 'google/gemini-2.5-flash')).toBe('Gemini');
    expect(aiName('openai', 'mistralai/mistral-small')).toBe('Mistral');
    expect(aiName('openai', 'meta-llama/llama-3.3-70b')).toBe('Llama');
    expect(aiName('openai', 'deepseek/deepseek-chat')).toBe('DeepSeek');
    expect(aiName('openai', 'x-ai/grok-3')).toBe('Grok');
    expect(aiName('openai', 'qwen/qwen-2.5')).toBe('Qwen');
    expect(aiName('openai', 'GPT-4o')).toBe('ChatGPT');
  });
  it('an id nobody knows is “your AI”', () => {
    expect(aiName('openai', 'my-finetune-7')).toBe('your AI');
    expect(aiName('openai', '')).toBe('your AI');
  });
  it('the default models are named', () => {
    expect(aiName('openai', DEFAULT_SETTINGS.aiModels.openai.quick)).toBe('Claude');
    expect(aiName('anthropic', DEFAULT_SETTINGS.aiModels.anthropic.quick)).toBe('Claude');
  });
});
