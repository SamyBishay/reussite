// The Copy diagnostics button and sheet, and an error boundary whose screen offers them.
import { Component, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { buildDiagnostics } from './diagnostics';
import { logError } from './errorlog';
import { openSheet, SheetHost } from './sheet';
import { toast } from './store';
import { t } from '../i18n';

function DiagnosticsSheet() {
  const [text, setText] = useState('');
  useEffect(() => { void buildDiagnostics().then(setText); }, []);
  const copy = () => {
    if (!navigator.clipboard) return toast(t('copyBlocked'));
    navigator.clipboard.writeText(text).then(() => toast(t('diagCopied')), () => toast(t('copyBlocked')));
  };
  return (
    <div data-testid="diagnostics">
      <h3>{t('diagTitle')}</h3>
      <p class="hint">{t('diagHint')}</p>
      <pre class="diag" data-testid="diagnostics-text">{text || t('loading')}</pre>
      <div class="actions"><button class="btn primary" type="button" disabled={!text} onClick={copy} data-testid="diagnostics-copy">{t('diagCopy')}</button></div>
    </div>
  );
}

export const openDiagnostics = () => openSheet(<DiagnosticsSheet key={'diag' + Date.now()} />);

export function DiagnosticsButton({ ghost = true }: { ghost?: boolean }) {
  return <button class={'btn small' + (ghost ? ' ghost' : '')} type="button" onClick={openDiagnostics} data-testid="diagnostics-open">{t('diagCopy')}</button>;
}

/** Last resort: a render error shows a plain screen with Reload and Copy diagnostics. */
export class ErrorBoundary extends Component<{ children?: ComponentChildren }, { failed: boolean }> {
  override state = { failed: false };
  override componentDidCatch(e: unknown) { void logError(e, 'render'); this.setState({ failed: true }); }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div class="app" role="alert" data-testid="crash">
        <h1 class="word">{t('appName')}</h1>
        <p>{t('crashed')}</p>
        <div class="actions"><button class="btn primary" type="button" onClick={() => location.reload()}>{t('reload')}</button><DiagnosticsButton /></div>
        <SheetHost />
      </div>
    );
  }
}
