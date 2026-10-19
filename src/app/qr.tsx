// QR codes for the recovery key: drawn as SVG (qrcode-generator, bundled, no requests), and
// read from the camera with BarcodeDetector where the browser has it, else jsQR (loaded on
// first use). Nothing here leaves the device.
import qrcode from 'qrcode-generator';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';

/** The dark modules of the code for `text` (a recovery key: upper case, digits and dashes, so alphanumeric mode). */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text.toUpperCase(), 'Alphanumeric');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** The code as SVG. Always dark on white, with a quiet zone: dark mode would make it unreadable. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const m = qrModules(text);
  const n = m.length, quiet = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r]![c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const size = n + quiet * 2;
  return (
    <svg class="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shape-rendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
const nativeDetector = (): Detector | null => {
  const B = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  try { return B ? new B({ formats: ['qr_code'] }) : null; } catch { return null; }
};

/** The camera, looking for a QR code; calls `onText` once with what it reads. */
export function QrScanner({ onText, onCancel }: { onText: (text: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    let stop = false;
    let stream: MediaStream | undefined;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const native = nativeDetector();
        const jsqr = native ? null : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        while (!stop) {
          await new Promise(r => setTimeout(r, 250));
          if (v.readyState < 2 || !v.videoWidth) continue;
          let found = '';
          if (native) found = (await native.detect(v).catch(() => []))[0]?.rawValue ?? '';
          else if (ctx && jsqr) {
            const w = Math.min(640, v.videoWidth), h = Math.round((w * v.videoHeight) / v.videoWidth);
            canvas.width = w; canvas.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            found = jsqr(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? '';
          }
          if (found) { stop = true; onText(found); }
        }
      } catch { if (!stop) setProblem(t('scanNoCamera')); }
    })();
    return () => { stop = true; stream?.getTracks().forEach(x => x.stop()); };
  }, []);
  return (
    <div class="scanner" data-testid="scanner">
      {problem ? <p class="err" role="alert">{problem}</p> : <video ref={video} playsInline muted aria-label={t('scanLabel')} />}
      <div class="actions"><button class="btn ghost" type="button" onClick={onCancel}>{t('scanStop')}</button></div>
    </div>
  );
}
