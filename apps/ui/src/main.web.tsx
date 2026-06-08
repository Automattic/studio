import { getLocaleData, isSupportedLocale } from '@studio/common/lib/locale';
import { defaultI18n } from '@wordpress/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { WpcomLoginScreen } from '@/components/wpcom-login-screen';
import { persistPromise } from '@/data/core';
import { createSecexConnector } from '@/data/core/connectors/secex';
import { createWebConnector } from '@/data/core/connectors/web';
import { beginLogin, captureTokenFromHash, getStoredToken } from '@/lib/wpcom-web-auth';
import type { Connector } from '@/data/core';

// Web entry point. Identical to `main.tsx` except it wires the HTTP/SSE web
// connector instead of the Electron IPC connector, so the same React app runs
// in a plain browser tab against the `studio web-server` backend.

async function loadTranslations( connector: Connector ) {
	const { locale } = await connector.getUserPreferences();
	if ( ! locale || ! isSupportedLocale( locale ) ) {
		return;
	}
	const translations = getLocaleData( locale )?.messages;
	if ( translations ) {
		defaultI18n.setLocaleData( translations );
	}
}

// Studio Web defaults to the classic (agentic) UI — it uses real-path routing
// that survives reloads/deep links, and it's the surface PR #3646 redesigns.
// Seed the persisted mode only when the user hasn't already chosen one.
function seedDefaultUiMode() {
	try {
		const hasParam = new URLSearchParams( window.location.search ).has( 'studio-ui-mode' );
		if ( ! hasParam && ! window.localStorage.getItem( 'studio-ui-mode' ) ) {
			window.localStorage.setItem( 'studio-ui-mode', 'classic' );
		}
	} catch {
		// Ignore storage failures.
	}
}

const isSecexMode = import.meta.env.VITE_STUDIO_BACKEND === 'secex';

// SecEx mode talks straight to the hosted endpoint from the browser, so it needs
// a WordPress.com token: prefer a real logged-in token, fall back to the build-time
// env var (handy for scripted runs).
function resolveSecexToken(): string {
	return getStoredToken() ?? import.meta.env.VITE_STUDIO_WPCOM_TOKEN ?? '';
}

// SecEx mode (`VITE_STUDIO_BACKEND=secex`) talks straight to the hosted wpcom
// Studio Code endpoint from the browser — no local web-server. The default mode
// keeps the localhost web-server connector.
function createConnector( token: string ): Connector {
	if ( isSecexMode ) {
		return createSecexConnector( {
			runUrl:
				import.meta.env.VITE_STUDIO_SECEX_RUN_URL ??
				'https://public-api.wordpress.com/wpcom/v2/studio-code/run',
			token,
		} );
	}
	return createWebConnector( {
		apiBaseUrl: import.meta.env.VITE_STUDIO_API_URL ?? 'http://localhost:8088',
	} );
}

function renderLogin() {
	createRoot( document.getElementById( 'root' )! ).render(
		<StrictMode>
			<WpcomLoginScreen onLogin={ beginLogin } />
		</StrictMode>
	);
}

async function bootstrap() {
	seedDefaultUiMode();

	// Pick up a token left in the URL fragment after a WordPress.com redirect.
	if ( isSecexMode ) {
		captureTokenFromHash();
		if ( ! resolveSecexToken() ) {
			renderLogin();
			return;
		}
	}

	const connector = createConnector( resolveSecexToken() );

	await Promise.all( [ connector.init?.(), loadTranslations( connector ), persistPromise ] );

	createRoot( document.getElementById( 'root' )! ).render(
		<StrictMode>
			<App connector={ connector } />
		</StrictMode>
	);
}

void bootstrap();
