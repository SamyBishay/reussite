// A throwaway VAPID pair for the end-to-end tests: the e2e relay signs with it (playwright.config.ts)
// and the tests' push stub verifies against it. Not a secret; it exists nowhere but here.
export const E2E_VAPID = {
  publicKey: 'BHj_zT3D5NS3lkq8lBUoPaEwB378tQ2Bro0LWn4Bm_WXy5ffwlJ5o_31_EJsN8jkUglHebA086yXZKuq2DZrEFI',
  privateKey: 'l49ay23HyFPmbj4lTnc0SOSUT4G04DFgR5Xa4FA-CoI',
};
