import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { __ } from '@wordpress/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { applyUserPreferences } from '@/app/apply-user-preferences';
import { toast } from '@/data/app-messages';
import { persistPromise } from '@/data/core';
import { completeRedirectSignIn, createStaticConnector } from '@/data/core/connectors/static';

// Web entry point, for a static deployment with no Studio server: identical to
// `main.local.tsx` except that it wires the `web` connector, which runs sites
// in WordPress Playground.

async function bootstrap() {
	// WordPress.com sign-in comes back to /auth/callback, then to the page it
	// started from.
	const signIn = await completeRedirectSignIn();
	if ( signIn ) {
		window.history.replaceState( null, '', signIn.returnTo );
	}

	const connector = createStaticConnector();

	await Promise.all( [ connector.init?.(), applyUserPreferences( connector ), persistPromise ] );

	createRoot( document.getElementById( 'root' )! ).render(
		<StrictMode>
			<App connector={ connector } />
		</StrictMode>
	);

	if ( signIn?.error ) {
		toast.error( __( 'Couldn’t sign in to WordPress.com' ), { description: signIn.error } );
	}
}

void bootstrap();
