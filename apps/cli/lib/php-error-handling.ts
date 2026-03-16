import type { Server as HttpServer } from 'http';

/**
 * Determines if an error from runCLI() is caused by user PHP code (themes/plugins)
 * rather than an infrastructure issue (WASM memory, port conflicts, etc.).
 *
 * Uses an exclusion list: known infrastructure errors return false, everything else
 * is treated as a PHP user error. This is safer than an inclusion list because
 * unrecognized errors show an error page (recoverable) instead of crashing the process.
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
 * Extract the actual PHP error from captured Playground output.
 *
 * Playground outputs PHP errors in HTML format like:
 *   <b>Fatal error</b>:  Uncaught Error: Call to undefined function foo() in /path/file.php:12
 * or with the PHP.run() wrapper:
 *   Error: PHP.run() failed with exit code 255.
 *   <b>Fatal error</b>:  Uncaught Error: ...
 */
export function parsePhpError( capturedOutput: string ): string {
	// Match Playground's HTML-formatted fatal error output
	// e.g., <b>Fatal error</b>:  Uncaught Error: Call to undefined function foo() in /file.php:12
	const htmlFatalMatch = capturedOutput.match(
		/<b>Fatal error<\/b>:\s*(.+?)(?:\s+in\s+\/wordpress\/(.+?:\d+)|$)/i
	);
	if ( htmlFatalMatch ) {
		const errorDetail = htmlFatalMatch[ 1 ].trim();
		const location = htmlFatalMatch[ 2 ] ? ` in ${ htmlFatalMatch[ 2 ] }` : '';
		return `Fatal error: ${ errorDetail }${ location }`;
	}

	// Match standard PHP fatal error format
	const fatalMatch = capturedOutput.match( /PHP Fatal error:\s*(.+)/i );
	if ( fatalMatch ) {
		return `PHP Fatal error: ${ fatalMatch[ 1 ].trim() }`;
	}

	// Fall back to WordPress critical error HTML output
	const wpDieMatch = capturedOutput.match( /<div class="wp-die-message"[^>]*>([\s\S]*?)<\/div>/ );
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

export function generateErrorPageHtml( errorMessage: string ): string {
	const escaped = errorMessage
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PHP Error</title>
<style>html{background:#f1f1f1}body{background:#fff;border:1px solid #ccd0d4;color:#444;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:2em auto;padding:1em 2em;max-width:700px}h1{color:#d63638;font-size:1.3em}pre{background:#f6f7f7;border:1px solid #dcdcde;padding:1em;white-space:pre-wrap;word-wrap:break-word;font-size:13px}.info{background:#f0f6fc;border-left:4px solid #72aee6;padding:12px 16px;margin:1.5em 0}</style>
</head><body><h1>PHP Error Detected</h1><pre>${ escaped }</pre>
<div class="info"><p><strong>Studio is watching for file changes.</strong> Fix the PHP error and the site will automatically restart.</p></div></body></html>`;
}

/**
 * Replaces the request handler on an HTTP server to serve an error page.
 */
export function serveErrorPage( httpServer: HttpServer, errorMessage: string ): void {
	const html = generateErrorPageHtml( errorMessage );
	httpServer.removeAllListeners( 'request' );
	httpServer.on( 'request', ( _req, res ) => {
		res.writeHead( 500, { 'Content-Type': 'text/html; charset=utf-8' } );
		res.end( html );
	} );
}
