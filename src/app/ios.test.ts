import { describe, it, expect } from 'vitest';
import { isIosApp, wantsIosClass } from './ios';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

describe('the iPhone home-screen app', () => {
  it('is navigator.standalone on an iPhone', () => {
    expect(isIosApp({ standalone: true, userAgent: IPHONE })).toBe(true);
  });
  it('is the standalone display mode with an iPhone and iOS-only WebKit', () => {
    expect(isIosApp({ displayStandalone: true, touchCallout: true, userAgent: IPHONE })).toBe(true);
    expect(isIosApp({ displayStandalone: true, touchCallout: false, userAgent: IPHONE })).toBe(false);
  });
  it('is not Safari in a tab, an installed Android app or an iPad', () => {
    expect(isIosApp({ standalone: false, userAgent: IPHONE })).toBe(false);
    expect(isIosApp({ standalone: undefined, displayStandalone: false, touchCallout: true, userAgent: IPHONE })).toBe(false);
    expect(isIosApp({ displayStandalone: true, touchCallout: false, userAgent: ANDROID })).toBe(false);
    expect(isIosApp({ standalone: true, userAgent: IPAD })).toBe(false);
  });
  it('gives the class unless the system already left room above the page', () => {
    expect(wantsIosClass({ standalone: true, userAgent: IPHONE, chromeGap: 0 })).toBe(true);
    expect(wantsIosClass({ standalone: true, userAgent: IPHONE })).toBe(true);
    expect(wantsIosClass({ standalone: true, userAgent: IPHONE, chromeGap: 62 })).toBe(false);
    expect(wantsIosClass({ standalone: false, userAgent: IPHONE })).toBe(false);
  });
});
