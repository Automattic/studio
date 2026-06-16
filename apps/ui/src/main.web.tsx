import { getLocaleData, isSupportedLocale } from '@studio/common/lib/locale';
import { defaultI18n } from '@wordpress/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { seedDefaultUiMode } from '@/app/use-ui-mode';
import { WpcomLoginScreen } from '@/components/wpcom-login-screen';
import { persistPromise } from '@/data/core';
import { createSecexConnector } from '@/data/core/connectors/secex';
import { createWebConnector } from '@/data/core/connectors/web';
import { beginLogin, captureTokenFromHash, getStoredToken } from '@/lib/wpcom-web-auth';
import type { Connector } from '@/data/core';

// Web entry point. Identical to `main.tsx` except it wires a browser connector
// instead of the Electron IPC connector, so the same React app runs in a plain
// browser tab. Two backends are selectable at build time via VITE_STUDIO_BACKEND:
// the default `studio web-server` (HTTP/SSE), or `secex` (the browser talks
// straight to the hosted wpcom Studio Code endpoint).

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

function getDefaultApiBaseUrl(): string {
	// Production builds are served by `studio web-server` itself, so the API is
	// same-origin. The Vite dev server (:5300) is a separate origin and targets
	// the backend's default port instead.
	return import.meta.env.DEV ? 'http://localhost:8088' : window.location.origin;
}

const isSecexMode = import.meta.env.VITE_STUDIO_BACKEND === 'secex';

// SecEx mode talks straight to the hosted endpoint from the browser, so it needs
// a WordPress.com token: prefer a real logged-in token, fall back to the
// build-time env var (handy for scripted runs).
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
		apiBaseUrl: import.meta.env.VITE_STUDIO_API_URL ?? getDefaultApiBaseUrl(),
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
	// Studio Web defaults to the classic (agentic) UI — it uses real-path
	// routing that survives reloads/deep links.
	seedDefaultUiMode( 'classic' );

	// SecEx mode needs a WordPress.com token: pick up one left in the URL
	// fragment after a redirect, and gate on login when there's none.
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
