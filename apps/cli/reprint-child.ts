/**
 * Reprint Child Process
 *
 * Runs reprint.phar via PHP WASM in an isolated child process so that
 * the parent's event loop stays responsive for Ctrl+C handling and
 * progress reporting. The parent communicates via IPC messages.
 */
import { rootCertificates } from 'node:tls';
import { createNodeFsMountHandler, loadNodeRuntime } from '@php-wasm/node';
import { PHP, ProcessIdAllocator, setPhpIniEntries } from '@php-wasm/universal';
import { createSpawnHandler } from '@php-wasm/util';
import { LatestSupportedPHPVersion } from '@studio/common/types/php-versions';

const processIdAllocator = new ProcessIdAllocator();

// Proxy configuration env vars must reach reprint.phar so it can route
// outbound HTTP through the user's proxy (e.g. tsocks / corporate
// MITMing proxy).  PHP WASM runs in a sandboxed runtime, so variables
// inherited by this child process are NOT automatically visible to
// the PHP side — they must be handed in via `php.cli({ env })`.
const PROXY_ENV_KEYS = [
	'ALL_PROXY',
	'all_proxy',
	'HTTPS_PROXY',
	'https_proxy',
	'HTTP_PROXY',
	'http_proxy',
	'NO_PROXY',
	'no_proxy',
] as const;

function collectProxyEnv(): Record< string, string > {
	const env: Record< string, string > = {};
	for ( const key of PROXY_ENV_KEYS ) {
		const value = process.env[ key ];
		if ( typeof value === 'string' && value.length > 0 ) {
			env[ key ] = value;
		}
	}
	return env;
}

function createNoopSpawnHandler() {
	return createSpawnHandler( async ( _args, processApi ) => {
		await new Promise( ( resolve ) => setTimeout( resolve, 1 ) );
		processApi.exit( 1 );
	} );
}

function sendAndFlush( msg: Record< string, unknown > ): Promise< void > {
	return new Promise< void >( ( resolve ) => {
		process.send!( msg, () => resolve() );
	} );
}

interface ReprintMount {
	hostPath: string;
	vfsPath: string;
}

interface RunMessage {
	type: 'run';
	pharPath: string;
	stateDir: string;
	fsRoot: string;
	tmpDir: string;
	args: string[];
	mounts?: ReprintMount[];
}

type ReprintChildMessage =
	| {
			type: 'result';
			stdout: string;
			stderr: string;
			exitCode: number;
	  }
	| {
			type: 'error';
			message: string;
	  }
	| {
			type: 'stdout';
			chunk: string;
	  }
	| {
			type: 'stderr';
			chunk: string;
	  };

async function mountDirectory( php: PHP, mount: ReprintMount ) {
	php.mkdir( mount.vfsPath );
	await php.mount( mount.vfsPath, createNodeFsMountHandler( mount.hostPath ) );
}

/**
 * Pipes a PHP stream to the parent process via IPC while keeping the
 * tail in a bounded ring-buffer.  reprint.phar can produce megabytes
 * of PHP deprecation/warning noise on stderr during a long files-sync;
 * without a cap, joining `buffer` at the end of the run allocates the
 * full payload in one go and blows up child-process memory.  The tail
 * is what matters for diagnostics (the last error before exit), so
 * older bytes are dropped once the ring is full.
 */
const STDERR_RING_BUFFER_BYTES = 256 * 1024;

async function pipePhpStreamIntoRing(
	stream: ReadableStream< Uint8Array >,
	type: 'stdout' | 'stderr',
	tail: { text: string }
) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();

	try {
		while ( true ) {
			const { done, value } = await reader.read();

			if ( done ) {
				return;
			}

			if ( ! value ) {
				continue;
			}

			const chunk = decoder.decode( value, { stream: true } );
			if ( ! chunk ) {
				continue;
			}

			tail.text = keepTail( tail.text + chunk, STDERR_RING_BUFFER_BYTES );
			await sendAndFlush( { type, chunk } satisfies ReprintChildMessage );
		}
	} finally {
		const remaining = decoder.decode();
		if ( remaining ) {
			tail.text = keepTail( tail.text + remaining, STDERR_RING_BUFFER_BYTES );
			await sendAndFlush( { type, chunk: remaining } satisfies ReprintChildMessage );
		}
		reader.releaseLock();
	}
}

function keepTail( text: string, maxBytes: number ): string {
	if ( text.length <= maxBytes ) {
		return text;
	}
	return text.slice( text.length - maxBytes );
}

/**
 * Pipes a PHP stream to the parent process via IPC while tracking only the
 * last complete line.  Unlike pipePhpStream which accumulates all chunks in
 * a buffer, this avoids unbounded memory growth for large stdout streams.
 */
async function pipePhpStreamTrackingLastLine(
	stream: ReadableStream< Uint8Array >,
	type: 'stdout' | 'stderr',
	tracker: { lastCompleteLine: string; remainder: string }
) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();

	try {
		while ( true ) {
			const { done, value } = await reader.read();

			if ( done ) {
				return;
			}

			if ( ! value ) {
				continue;
			}

			const chunk = decoder.decode( value, { stream: true } );
			if ( ! chunk ) {
				continue;
			}

			const combined = tracker.remainder + chunk;
			const lines = combined.split( '\n' );
			tracker.remainder = lines.pop() ?? '';
			for ( let i = lines.length - 1; i >= 0; i-- ) {
				if ( lines[ i ].trim() ) {
					tracker.lastCompleteLine = lines[ i ];
					break;
				}
			}

			await sendAndFlush( { type, chunk } satisfies ReprintChildMessage );
		}
	} finally {
		const remaining = decoder.decode();
		if ( remaining ) {
			tracker.remainder += remaining;
			await sendAndFlush( { type, chunk: remaining } satisfies ReprintChildMessage );
		}
		reader.releaseLock();
	}
}

async function runReprint( msg: RunMessage ) {
	const { pharPath, stateDir, fsRoot, tmpDir, args, mounts = [] } = msg;

	const id = await loadNodeRuntime( LatestSupportedPHPVersion, {
		followSymlinks: true,
		emscriptenOptions: {
			processId: processIdAllocator.claim(),
		},
	} );
	const php = new PHP( id );

	try {
		await php.setSapiName( 'cli' );

		await mountDirectory( php, { hostPath: tmpDir, vfsPath: '/tmp' } );
		await mountDirectory( php, { hostPath: stateDir, vfsPath: stateDir } );
		await mountDirectory( php, { hostPath: fsRoot, vfsPath: fsRoot } );

		for ( const mount of mounts ) {
			await mountDirectory( php, mount );
		}

		await php.mount( '/tmp/reprint.phar', createNodeFsMountHandler( pharPath ) );

		php.writeFile( '/tmp/ca-bundle.crt', rootCertificates.join( '\n' ) );
		await setPhpIniEntries( php, {
			'openssl.cafile': '/tmp/ca-bundle.crt',
			allow_url_fopen: 1,
			memory_limit: '512M',
			error_reporting: String( 32767 & ~8192 ),
			display_errors: 'stderr',
			log_errors: 0,
		} );

		await php.setSpawnHandler( createNoopSpawnHandler() );

		const response = await php.cli( [ 'php', '/tmp/reprint.phar', ...args ], {
			env: collectProxyEnv(),
		} );

		// Track only the last complete stdout line (the result envelope)
		// and the tail of stderr.  reprint emits JSON-L with thousands of
		// progress lines on stdout and can emit megabytes of PHP warnings
		// on stderr for large imports; both trackers keep memory bounded.
		const stdoutTracker = { lastCompleteLine: '', remainder: '' };
		const stderrTail = { text: '' };

		const [ exitCode ] = await Promise.all( [
			response.exitCode,
			pipePhpStreamTrackingLastLine( response.stdout, 'stdout', stdoutTracker ),
			pipePhpStreamIntoRing( response.stderr, 'stderr', stderrTail ),
		] );

		const finalLine = stdoutTracker.remainder.trim() || stdoutTracker.lastCompleteLine;

		await sendAndFlush( {
			type: 'result',
			stdout: finalLine,
			stderr: stderrTail.text,
			exitCode,
		} satisfies ReprintChildMessage );
	} catch ( error ) {
		await sendAndFlush( {
			type: 'error',
			message: error instanceof Error ? error.message : String( error ),
		} satisfies ReprintChildMessage );
	} finally {
		php.exit();
	}
}

process.on( 'message', async ( msg: RunMessage ) => {
	if ( msg.type !== 'run' ) {
		return;
	}

	try {
		await runReprint( msg );
	} catch ( error ) {
		try {
			await sendAndFlush( {
				type: 'error',
				message: error instanceof Error ? error.message : String( error ),
			} );
		} catch {
			// IPC channel may already be closed.
		}
		process.exit( 1 );
	}
} );
