import './zod-config';
import { render } from 'preact';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-mono/400.css';
import '@fontsource/atkinson-hyperlegible-mono/600.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/app-phase1.css';
import './styles/app-onboarding.css';
import './styles/app-look.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/Diagnostics';
import { startErrorLog } from './app/errorlog';
import { markIosApp } from './app/ios';
import { Topbar } from './app/Topbar';
import { watchTopbar } from './app/topbarSize';

startErrorLog();
markIosApp();
render(<ErrorBoundary><App /></ErrorBoundary>, document.getElementById('root')!);
// The top edge is in index.html already; its content is drawn into it and it is never replaced.
const topbar = document.getElementById('topbar')!;
render(<Topbar />, topbar);
watchTopbar(topbar);
