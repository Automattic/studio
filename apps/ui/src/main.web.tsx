import { getLocaleData, isSupportedLocale } from '@studio/common/lib/locale';
import { defaultI18n } from '@wordpress/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { persistPromise } from '@/data/core';
import { createSecexConnector } from '@/data/core/connectors/secex';
import { createWebConnector } from '@/data/core/connectors/web';
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

// SecEx mode (`VITE_STUDIO_BACKEND=secex`) talks straight to the hosted wpcom
// Studio Code endpoint from the browser — no local web-server. The default mode
// keeps the localhost web-server connector.
function createConnector(): Connector {
	if ( import.meta.env.VITE_STUDIO_BACKEND === 'secex' ) {
		return createSecexConnector( {
			runUrl:
				import.meta.env.VITE_STUDIO_SECEX_RUN_URL ??
				'https://public-api.wordpress.com/wpcom/v2/studio-code/run',
			token: import.meta.env.VITE_STUDIO_WPCOM_TOKEN ?? '',
		} );
	}
	return createWebConnector( {
		apiBaseUrl: import.meta.env.VITE_STUDIO_API_URL ?? 'http://localhost:8088',
	} );
}

async function bootstrap() {
	seedDefaultUiMode();

	const connector = createConnector();

	await Promise.all( [ connector.init?.(), loadTranslations( connector ), persistPromise ] );

	createRoot( document.getElementById( 'root' )! ).render(
		<StrictMode>
			<App connector={ connector } />
		</StrictMode>
	);
}

void bootstrap();
