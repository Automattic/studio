// Lightweight diagnostic logging for the web-server, opt-in via
// `STUDIO_WEB_DEBUG=1`. The server is a loopback-only dev backend, so logs go
// straight to stderr. Useful while bringing up the hosted (SecEx) backend,
// where the run streams from a remote sandbox and the failure modes aren't
// visible in the browser.
const ENABLED = process.env.STUDIO_WEB_DEBUG === '1' || process.env.STUDIO_WEB_DEBUG === 'true';

export function wdbg( scope: string, ...args: unknown[] ): void {
	if ( ! ENABLED ) {
		return;
	}

	console.error( `[web-server:${ scope }]`, ...args );
}
