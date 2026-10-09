import { render } from 'preact';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-mono/400.css';
import '@fontsource/atkinson-hyperlegible-mono/600.css';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './app/App';

// Ask the browser to keep our data even under storage pressure (shown in Settings).
void navigator.storage?.persist?.().catch(() => undefined);

render(<App />, document.getElementById('root')!);
