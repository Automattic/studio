import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { __ } from '@wordpress/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { applyUserPreferences } from '@/app/apply-user-preferences';
import { loadStartupRouter } from '@/app/load-startup-router';
import { StartupScreen } from '@/app/startup-screen';
import { toast } from '@/data/app-messages';
import { persistPromise, queryClient } from '@/data/core';
import { completeRedirectSignIn, createStaticConnector } from '@/data/core/connectors/static';

// Static entry point, for a deployment with no Studio server: wires the `static`
// connector, which runs sites in WordPress Playground.

async function bootstrap() {
	const root = createRoot( document.getElementById( 'root' )! );
	root.render( <StartupScreen /> );

	// WordPress.com sign-in comes back to /auth/callback, then to the page it
	// started from.
	const signIn = await completeRedirectSignIn();
	if ( signIn ) {
		window.history.replaceState( null, '', signIn.returnTo );
	}

	const connector = createStaticConnector();

	await Promise.all( [ connector.init?.(), applyUserPreferences( connector ), persistPromise ] );
	const router = await loadStartupRouter( connector, queryClient );

	root.render(
		<StrictMode>
			<App connector={ connector } router={ router } />
		</StrictMode>
	);

	if ( signIn?.error ) {
		toast.error( __( 'Couldn’t sign in to WordPress.com' ), { description: signIn.error } );
	}
}

void bootstrap();
