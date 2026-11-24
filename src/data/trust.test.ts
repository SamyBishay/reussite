import { describe, expect, it } from 'vitest';
import { approved, destination, firstUse } from './trust';

describe('credential destinations', () => {
  it('compares scheme, host and path, not slashes or case', () => {
    expect(destination(' HTTPS://Relay.example.com/v1/ ')).toBe('https://relay.example.com/v1');
    expect(destination('nonsense')).toBe('');
  });
  it('the default and the approved value are trusted; a restored other value is not', () => {
    expect(approved('https://a.example', 'https://a.example/', null)).toBe(true);
    expect(approved('https://mine.example', 'https://a.example', 'https://mine.example/')).toBe(true);
    expect(approved('https://evil.example', 'https://a.example', 'https://mine.example')).toBe(false);
    expect(approved('https://evil.example', 'https://a.example', undefined)).toBe(false);
    expect(approved('', '', null)).toBe(false);
    expect(approved('http://localhost:8787', 'https://a.example', null)).toBe(true);
    expect(approved('http://localhost.evil.example', 'https://a.example', null)).toBe(false);
  });
  it('a device with nothing approved yet keeps what it has, once', () => {
    expect(firstUse('https://mine.example/', undefined)).toBe('https://mine.example');
    expect(firstUse('https://mine.example', 'https://x.example')).toBeNull();
  });
});
