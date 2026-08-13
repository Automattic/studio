import http from 'http';
import { watch as watchPaths, FSWatcher } from 'chokidar';
import type { SiteServer } from 'src/site-server';

const activeRecoveries = new Map<
	string,
	{
		siteServer: SiteServer;
		errorServer: http.Server;
		watcher: FSWatcher;
		debounceTimer?: ReturnType< typeof setTimeout >;
	}
>();

/**
 * Determines if an error from a site start failure is caused by user PHP code
 * (themes/plugins) rather than an infrastructure issue (WASM memory, port conflicts, etc.).
 *
 * Uses an exclusion list: known infrastructure errors return false, everything else
 * is treated as a PHP user error.
 */
export function isPhpUserError( error: unknown ): boolean {
	if ( ! ( error instanceof Error ) ) {
		return false;
	}

	const message = error.message;

	const isInfrastructureError =
		message.includes( 'Cannot allocate Wasm memory' ) ||
		message.includes( 'EADDRINUSE' ) ||
		message.includes( 'Operation aborted' ) ||
		message.includes( '"unreachable" WASM instruction' );

	return ! isInfrastructureError;
}

/**
 * Extract the actual PHP error from PM2 log output.
 *
 * Playground outputs PHP errors in HTML format like:
 *   <b>Fatal error</b>:  Uncaught Error: Call to undefined function foo() in /path/file.php:12
 */
export function parsePhpError( logContent: string ): string {
	const htmlFatalMatch = logContent.match(
		/<b>Fatal error<\/b>:\s*(.+?)(?:\s+in\s+\/wordpress\/(.+?:\d+)|$)/i
	);
	if ( htmlFatalMatch ) {
		const errorDetail = htmlFatalMatch[ 1 ].trim();
		const location = htmlFatalMatch[ 2 ] ? ` in ${ htmlFatalMatch[ 2 ] }` : '';
		return `Fatal error: ${ errorDetail }${ location }`;
	}

	const fatalMatch = logContent.match( /PHP Fatal error:\s*(.+)/i );
	if ( fatalMatch ) {
		return `PHP Fatal error: ${ fatalMatch[ 1 ].trim() }`;
	}

	const wpDieMatch = logContent.match( /<div class="wp-die-message"[^>]*>([\s\S]*?)<\/div>/ );
	if ( wpDieMatch ) {
		const textContent = wpDieMatch[ 1 ]
			.replace( /<[^>]+>/g, ' ' )
			.replace( /\s+/g, ' ' )
			.trim();
		if ( textContent ) {
			return `WordPress error: ${ textContent }`;
		}
	}

	return 'PHP error during startup';
}

function generateErrorPageHtml( errorMessage: string ): string {
	const escaped = errorMessage
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PHP Error</title>
<style>html{background:#f1f1f1}body{background:#fff;border:1px solid #ccd0d4;color:#444;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:2em auto;padding:1em 2em;max-width:700px}h1{color:#d63638;font-size:1.3em}pre{background:#f6f7f7;border:1px solid #dcdcde;padding:1em;white-space:pre-wrap;word-wrap:break-word;font-size:13px}.info{background:#f0f6fc;border-left:4px solid #72aee6;padding:12px 16px;margin:1.5em 0}</style>
</head><body><h1>PHP Error Detected</h1><pre>${ escaped }</pre>
<div class="info"><p><strong>Studio is watching for file changes.</strong> Fix the PHP error, then refresh this page.</p></div></body></html>`;
}

/**
 * Start error recovery for a site with a PHP error.
 * Serves an error page on the site's port and watches for PHP file changes.
 * On file change, retries starting the site.
 */
export async function startErrorRecovery(
	siteServer: SiteServer,
	errorMessage: string,
	readPm2Logs: ( siteId: string ) => { stdout?: string[]; stderr?: string[] }
): Promise< void > {
	const { id, port, path } = siteServer.details;

	await stopErrorRecovery( id );

	const errorServer = http.createServer( ( _req, res ) => {
		// Serve 200, not 500: this is Studio's own status page (the error is in the content), and the
		// thumbnail screenshot window rejects responses with status >= 500, which would keep a stale
		// capture instead of showing the error page.
		res.writeHead( 200, { 'Content-Type': 'text/html; charset=utf-8' } );
		res.end( generateErrorPageHtml( errorMessage ) );
	} );

	await new Promise< void >( ( resolve, reject ) => {
		errorServer.on( 'error', reject );
		errorServer.listen( port, () => resolve() );
	} );

	let retrying = false;
	// chokidar instead of fs.watch({ recursive: true }), which is not reliably supported on Linux
	// (Studio ships a Linux build). chokidar v4+ dropped globs, so filter for `.php` on the path.
	const watcher = watchPaths( path, {
		ignoreInitial: true,
		persistent: true,
		ignorePermissionErrors: true,
		ignored: ( entryPath: string ) => /[\\/](node_modules|\.git)([\\/]|$)/.test( entryPath ),
	} );
	watcher.on( 'error', ( error ) => {
		console.error( `[PHP Recovery - ${ id }] File watcher error:`, error );
	} );
	watcher.on( 'all', ( _event, filename ) => {
		if ( ! filename.endsWith( '.php' ) || retrying ) {
			return;
		}

		const recovery = activeRecoveries.get( id );
		if ( recovery?.debounceTimer ) {
			clearTimeout( recovery.debounceTimer );
		}

		if ( recovery ) {
			recovery.debounceTimer = setTimeout( () => {
				void ( async () => {
					retrying = true;
					console.log( `[PHP Recovery - ${ id }] PHP file change detected, retrying...` );
					// Tear down this recovery (frees the port, clears the fake running state,
					// closes this watcher) before attempting the real start.
					await stopErrorRecovery( id );
					try {
						await siteServer.start();
						console.log( `[PHP Recovery - ${ id }] Site recovered successfully` );
					} catch {
						// Still failing - re-serve the error page with the latest error and keep watching.
						console.log( `[PHP Recovery - ${ id }] Retry failed, still watching...` );
						const pm2Logs = readPm2Logs( id );
						const logContent = [ ...( pm2Logs.stdout ?? [] ), ...( pm2Logs.stderr ?? [] ) ].join(
							'\n'
						);
						await startErrorRecovery( siteServer, parsePhpError( logContent ), readPm2Logs );
					} finally {
						retrying = false;
					}
				} )();
			}, 500 );
		}
	} );

	activeRecoveries.set( id, { siteServer, errorServer, watcher } );

	// Mark the site running (serving the error page) so the UI shows it as reachable. The CLI
	// reports it stopped, so `inErrorRecovery` keeps running-state adoption (the events subscriber
	// and the reconciler) from overwriting this. stopErrorRecovery clears both.
	siteServer.inErrorRecovery = true;
	const url = `http://localhost:${ port }`;
	siteServer.details = {
		...siteServer.details,
		running: true,
		url,
	};
	siteServer.server.url = url;
}

/**
 * Stop error recovery for a site: close the error server and file watcher, and clear the
 * "serving error page" running state. Awaits the error server close so the site's port is
 * released — and clears `running` so SiteServer.start()'s guard doesn't skip a real restart —
 * before returning.
 */
export async function stopErrorRecovery( siteId: string ): Promise< void > {
	const recovery = activeRecoveries.get( siteId );
	if ( ! recovery ) {
		return;
	}

	activeRecoveries.delete( siteId );
	if ( recovery.debounceTimer ) {
		clearTimeout( recovery.debounceTimer );
	}
	await recovery.watcher.close();

	recovery.siteServer.inErrorRecovery = false;
	const { running, ...rest } = recovery.siteServer.details;
	if ( 'url' in rest ) {
		const { url, ...stopped } = rest;
		recovery.siteServer.details = { running: false, ...stopped };
	} else {
		recovery.siteServer.details = { running: false, ...rest };
	}

	await new Promise< void >( ( resolve ) => recovery.errorServer.close( () => resolve() ) );
}

/**
 * Check if a site is currently in error recovery mode.
 */
export function isInErrorRecovery( siteId: string ): boolean {
	return activeRecoveries.has( siteId );
}
