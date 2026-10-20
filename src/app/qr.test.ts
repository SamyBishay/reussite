import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { qrModules } from './qr';
import { encodeRecoveryKey, generateKey } from '../sync/keys';

describe('the recovery key QR code', () => {
  it('reads back as the key, through the same decoder the camera falls back to', () => {
    const key = encodeRecoveryKey(generateKey());
    const m = qrModules(key), scale = 6, quiet = 4, size = (m.length + quiet * 2) * scale;
    const px = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) {
      if (!m[r]![c]) continue;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
        const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
    }
    expect(jsQR(px, size, size)?.data).toBe(key);
    expect(m.length).toBeLessThanOrEqual(41); // a small code: version 6 or less
  });
});
