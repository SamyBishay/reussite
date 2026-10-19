import './zod-config';
import { render } from 'preact';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-mono/400.css';
import '@fontsource/atkinson-hyperlegible-mono/600.css';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/Diagnostics';
import { startErrorLog } from './app/errorlog';

startErrorLog();
render(<ErrorBoundary><App /></ErrorBoundary>, document.getElementById('root')!);
