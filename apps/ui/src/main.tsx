import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { persistPromise } from '@/data/core';
import type { AppTarget } from '@/app';
import type { Connector } from '@/data/core';

async function handleOAuthCallbackIfNeeded(): Promise< boolean > {
	if ( ! window.location.pathname.startsWith( '/auth/callback' ) || ! window.location.hash ) {
		return false;
	}

	const { handleOAuthCallback } = await import( '@/data/core/connectors/rest' );
	try {
		await handleOAuthCallback( window.location.hash );
	} catch ( error ) {
		console.error( 'OAuth callback failed:', error );
	}

	// Clear the hash and redirect to root, bypassing the router entirely.
	window.location.replace( '/' );
	return true;
}

async function bootstrap() {
	// Handle OAuth callback before mounting React to avoid router parsing issues
	// with special characters in the access token hash fragment.
	const handled = await handleOAuthCallbackIfNeeded();
	if ( handled ) {
		return;
	}

	let connector: Connector;
	let target: AppTarget;

	if ( __IS_ELECTRON__ ) {
		const { createIpcConnector } = await import( '@/data/core/connectors/ipc' );
		connector = createIpcConnector();
		target = 'electron';
	} else {
		const { createRestConnector } = await import( '@/data/core/connectors/rest' );
		connector = createRestConnector();
		target = 'web';
	}

	await persistPromise;

	createRoot( document.getElementById( 'root' )! ).render(
		<StrictMode>
			<App connector={ connector } target={ target } />
		</StrictMode>
	);
}

void bootstrap();
