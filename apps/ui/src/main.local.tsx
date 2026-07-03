import { getLocaleData, isSupportedLocale } from '@studio/common/lib/locale';
import { defaultI18n } from '@wordpress/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { persistPromise } from '@/data/core';
import { createLocalConnector } from '@/data/core/connectors/local';
import type { Connector } from '@/data/core';

// Local entry point. Identical to `main.tsx` except it wires the HTTP/SSE local
// connector instead of the Electron IPC connector, so the same React app runs
// in a plain browser tab against the local server started by `studio ui`
// (`apps/local`, bundled into the Studio CLI).

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
	// Production builds are served by the local server itself, so the API is
	// same-origin. The Vite dev server (:5400) is a separate origin and targets
	// the server's default port instead.
	return import.meta.env.DEV ? 'http://localhost:8081' : window.location.origin;
}

async function bootstrap() {
	const connector = createLocalConnector( {
		apiBaseUrl: import.meta.env.VITE_STUDIO_API_URL ?? getDefaultApiBaseUrl(),
	} );

	await Promise.all( [ connector.init?.(), loadTranslations( connector ), persistPromise ] );

	createRoot( document.getElementById( 'root' )! ).render(
		<StrictMode>
			{ /* `studio ui` stays on the agentic UI; it doesn't use the desk/agentic
			     mode switcher. */ }
			<App connector={ connector } forcedMode="classic" />
		</StrictMode>
	);
}

void bootstrap();
