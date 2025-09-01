import { spawn } from 'child_process';
import http from 'http';
import { SiteDetails } from 'common/types/sites';

interface StartSiteResult {
	pid: number;
}

// Health check configuration constants
const HEALTH_CHECK_TIMEOUT = 65000; // 65 seconds total timeout
const INITIAL_STARTUP_DELAY = 5000; // 5 seconds initial wait
const HEALTH_CHECK_INTERVAL = 1000; // Check every 1 second
const HTTP_REQUEST_TIMEOUT = 2000; // 2 seconds per HTTP request

/**
 * Check if a process with given PID is still running
 * @param pid Process ID to check
 * @returns true if process is running, false otherwise
 */
function isProcessRunning( pid: number ): boolean {
	try {
		// Sending signal 0 to a process doesn't kill it, just checks if it exists
		process.kill( pid, 0 );
		return true;
	} catch ( error ) {
		return false;
	}
}

/**
 * Performs a single HTTP health check to determine if WordPress is responding
 * @param port Port number to check
 * @returns Promise that resolves if server is healthy, rejects if not ready
 */
function performHealthCheck( port: number ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const req = http.request(
			{
				hostname: 'localhost',
				port,
				method: 'HEAD',
				timeout: HTTP_REQUEST_TIMEOUT,
			},
			( res ) => {
				// Server is responding, WordPress is ready
				// Accept success responses and redirects (common for WordPress)
				if (
					res.statusCode &&
					( res.statusCode < 400 || res.statusCode === 302 || res.statusCode === 301 )
				) {
					resolve();
				} else {
					reject( new Error( `Unexpected HTTP status: ${ res.statusCode }` ) );
				}
			}
		);

		req.on( 'error', reject );
		req.on( 'timeout', () => {
			req.destroy();
			reject( new Error( 'HTTP request timeout' ) );
		} );

		req.end();
	} );
}

/**
 * Start a WordPress site using Playground CLI as a child process
 *
 * Spawns a detached WordPress Playground server process and waits for it to be ready
 * using HTTP health checks. The process runs independently after this function returns.
 *
 * @param siteDetails Site configuration including path, port, and PHP version
 * @returns Promise resolving to an object containing the process PID
 * @throws Error if site is already running, port is undefined, or startup fails
 */
export async function startSite( siteDetails: SiteDetails ): Promise< StartSiteResult > {
	if ( siteDetails.running ) {
		throw new Error( 'Site is already running' );
	}

	if ( ! siteDetails.port ) {
		throw new Error( 'Site port is not defined' );
	}
	const port: number = siteDetails.port;

	// Use npx to run @wp-playground/cli - this will find the local package first
	const args = [
		'@wp-playground/cli',
		'server',
		'--skip-wordpress-setup',
		'--port',
		port.toString(),
		'--login',
		'--mount-before-install',
		`${ siteDetails.path }:/wordpress`,
	];

	if ( siteDetails.phpVersion ) {
		args.push( '--php', siteDetails.phpVersion );
	}

	const childProcess = spawn( 'npx', args, {
		detached: true,
		stdio: 'ignore',
	} );

	const pid = childProcess.pid;

	if ( ! pid ) {
		throw new Error( 'Failed to start playground server: no PID available' );
	}

	// Detach the process so it continues running independently
	childProcess.unref();

	// Wait for WordPress to be ready using health checks
	await new Promise< void >( ( resolve, reject ) => {
		let timeoutId: NodeJS.Timeout | null = null;
		let intervalId: NodeJS.Timeout | null = null;
		let isResolved = false;

		const cleanup = () => {
			if ( timeoutId ) {
				clearTimeout( timeoutId );
				timeoutId = null;
			}
			if ( intervalId ) {
				clearInterval( intervalId );
				intervalId = null;
			}
		};

		const resolveAndCleanup = ( result?: void ) => {
			if ( isResolved ) return;
			isResolved = true;
			cleanup();
			resolve( result );
		};

		const rejectAndCleanup = ( error: Error ) => {
			if ( isResolved ) return;
			isResolved = true;
			cleanup();
			reject( error );
		};

		// Set overall timeout
		timeoutId = setTimeout( () => {
			rejectAndCleanup( new Error( 'Timeout waiting for WordPress to be ready' ) );
		}, HEALTH_CHECK_TIMEOUT );

		// Initial wait for process to start up, then begin health checks
		setTimeout( () => {
			if ( ! isProcessRunning( pid ) ) {
				rejectAndCleanup( new Error( 'Playground server failed to start or crashed immediately' ) );
				return;
			}

			// Start periodic health checks
			intervalId = setInterval( () => {
				if ( ! isProcessRunning( pid ) ) {
					rejectAndCleanup( new Error( 'Playground server stopped before being ready' ) );
					return;
				}

				performHealthCheck( port )
					.then( () => {
						resolveAndCleanup(); // Server is ready!
					} )
					.catch( () => {
						// Server not ready yet, will try again on next interval
						// No need to log - this is expected during startup
					} );
			}, HEALTH_CHECK_INTERVAL );
		}, INITIAL_STARTUP_DELAY );
	} );

	return { pid };
}

/**
 * Stop a WordPress site by terminating its process
 *
 * Sends a SIGTERM signal to the site's process if a PID is available.
 * If no PID is available but the site is marked as running, it may have
 * been started by the Studio app.
 *
 * @param siteDetails Site details containing the PID to terminate
 * @throws Error if site is running but no PID is available
 */
export async function stopSite( siteDetails: SiteDetails ): Promise< void > {
	if ( siteDetails.pid ) {
		try {
			process.kill( siteDetails.pid, 'SIGTERM' );
		} catch ( error ) {
			// Process already dead, continue
		}
	} else if ( siteDetails.running ) {
		throw new Error(
			'Cannot stop site: no PID available for running site. This site may have been launched with the Studio App.'
		);
	}
}
