import { useEffect, useRef } from 'react';
import type { SitePreviewFile } from '@/data/core';
import type { PlaygroundClient } from '@wp-playground/client';

// The Playground worker is hosted remotely; the iframe loads it cross-origin.
const REMOTE_URL = 'https://playground.wordpress.net/remote.html';

function base64ToBytes( base64: string ): Uint8Array {
	const binary = atob( base64 );
	const bytes = new Uint8Array( binary.length );
	for ( let i = 0; i < binary.length; i++ ) {
		bytes[ i ] = binary.charCodeAt( i );
	}
	return bytes;
}

function posixDirname( filePath: string ): string {
	const slash = filePath.lastIndexOf( '/' );
	return slash <= 0 ? '/' : filePath.slice( 0, slash );
}

// `mkdir` isn't guaranteed recursive, so create each parent segment in turn.
// Existing dirs throw, which we swallow.
async function ensureDir( client: PlaygroundClient, dir: string ): Promise< void > {
	const parts = dir.split( '/' ).filter( Boolean );
	let current = '';
	for ( const part of parts ) {
		current += `/${ part }`;
		try {
			await client.mkdir( current );
		} catch {
			// Directory already exists.
		}
	}
}

// Overlay the agent's files onto the booted WordPress install at `documentRoot`.
async function overlayFiles(
	client: PlaygroundClient,
	documentRoot: string,
	files: SitePreviewFile[]
): Promise< void > {
	for ( const file of files ) {
		const absolutePath = `${ documentRoot }/${ file.path }`.replace( /\/+/g, '/' );
		await ensureDir( client, posixDirname( absolutePath ) );
		await client.writeFile( absolutePath, base64ToBytes( file.contentBase64 ) );
	}
}

// If the agent produced exactly one theme, return its slug so we can activate it.
// Ambiguous cases (zero or many themes) keep the default theme.
function singleThemeSlug( files: SitePreviewFile[] ): string | undefined {
	const slugs = new Set< string >();
	for ( const file of files ) {
		const match = /^wp-content\/themes\/([^/]+)\//.exec( file.path );
		if ( match ) {
			slugs.add( match[ 1 ] );
		}
	}
	return slugs.size === 1 ? [ ...slugs ][ 0 ] : undefined;
}

/**
 * Renders a live, client-side WordPress Playground preview of what the agent
 * built. WordPress runs entirely in the visitor's browser (PHP-WASM); the
 * agent's workspace files are overlaid onto it. This is "Carril A" of Studio
 * Web preview: no server-side site serving, no sandbox ingress — the preview
 * scales to the visitor's CPU and updates as the agent edits.
 *
 * `files` is re-overlaid whenever its identity changes (the parent re-fetches
 * after each agent turn via the `preview` SSE signal), so the preview follows
 * the agent's work without a full re-import of WordPress itself.
 */
export function LivePlaygroundPreview( { files }: { files: SitePreviewFile[] } ) {
	const iframeRef = useRef< HTMLIFrameElement >( null );
	const clientRef = useRef< Promise< PlaygroundClient > | null >( null );

	// Boot WordPress once when the iframe mounts.
	useEffect( () => {
		const iframe = iframeRef.current;
		// Guard against React StrictMode's double-invoked effects (and any re-run):
		// `startPlaygroundWeb` throws "Playground already booted" if the same iframe
		// is booted twice. `clientRef.current` is already set (a pending or resolved
		// boot) on the second invocation, so we skip it.
		if ( ! iframe || clientRef.current ) {
			return;
		}
		// Lazy-loaded: the Playground client is only pulled in when a preview is
		// actually shown, keeping it out of the initial bundle.
		clientRef.current = ( async () => {
			const { startPlaygroundWeb } = await import( '@wp-playground/client' );
			const client = await startPlaygroundWeb( {
				iframe,
				remoteUrl: REMOTE_URL,
				blueprint: { landingPage: '/', preferredVersions: { php: '8.3', wp: 'latest' } },
			} );
			await client.isReady();
			return client;
		} )();
	}, [] );

	// Overlay the agent's files (and reload) whenever they change.
	useEffect( () => {
		let cancelled = false;
		void ( async () => {
			const client = await clientRef.current;
			if ( ! client || cancelled ) {
				return;
			}
			const documentRoot = await client.documentRoot;
			await overlayFiles( client, documentRoot, files );
			const hasDb = files.some( ( f ) => f.path === 'wp-content/database/.ht.sqlite' );
			if ( hasDb ) {
				// The overlaid SQLite DB carries the sandbox site's real content, its
				// active theme, and its options — including siteurl/home pointing at the
				// sandbox server (http://localhost:PORT). Repoint those at the Playground
				// origin so links and assets resolve; the DB already drives the active
				// theme and content, so no switch_theme is needed.
				const origin = ( await client.absoluteUrl ).replace( /\/$/, '' );
				try {
					await client.run( {
						code:
							`<?php require '${ documentRoot }/wp-load.php'; ` +
							`update_option('siteurl', '${ origin }'); update_option('home', '${ origin }');`,
					} );
				} catch {
					// Best-effort: without the repoint, links point at localhost but the
					// page still renders.
				}
			} else {
				const themeSlug = singleThemeSlug( files );
				if ( themeSlug ) {
					try {
						await client.run( {
							code: `<?php require '${ documentRoot }/wp-load.php'; switch_theme( '${ themeSlug }' );`,
						} );
					} catch {
						// Best-effort: a failed activation just falls back to the default theme.
					}
				}
			}
			if ( ! cancelled ) {
				await client.goTo( '/' );
			}
		} )();
		return () => {
			cancelled = true;
		};
	}, [ files ] );

	return (
		<iframe
			ref={ iframeRef }
			title="Live site preview"
			style={ { width: '100%', height: '100%', border: 0, background: '#fff' } }
		/>
	);
}
