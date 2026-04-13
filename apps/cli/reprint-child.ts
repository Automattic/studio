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

async function pipePhpStream(
	stream: ReadableStream< Uint8Array >,
	type: 'stdout' | 'stderr',
	buffer: string[]
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

			buffer.push( chunk );
			await sendAndFlush( { type, chunk } satisfies ReprintChildMessage );
		}
	} finally {
		const remaining = decoder.decode();
		if ( remaining ) {
			buffer.push( remaining );
			await sendAndFlush( { type, chunk: remaining } satisfies ReprintChildMessage );
		}
		reader.releaseLock();
	}
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

		const response = await php.cli( [ 'php', '/tmp/reprint.phar', ...args ] );
		const stderrChunks: string[] = [];

		// Track only the last complete stdout line (the result envelope).
		// reprint emits JSON-L with thousands of progress lines for large
		// sites — accumulating them all would blow up memory.  The stdout
		// tracker below replaces the old pattern of buffering all chunks
		// and joining them at the end.
		const stdoutTracker = { lastCompleteLine: '', remainder: '' };

		const [ exitCode ] = await Promise.all( [
			response.exitCode,
			pipePhpStreamTrackingLastLine( response.stdout, 'stdout', stdoutTracker ),
			pipePhpStream( response.stderr, 'stderr', stderrChunks ),
		] );

		const finalLine = stdoutTracker.remainder.trim() || stdoutTracker.lastCompleteLine;

		await sendAndFlush( {
			type: 'result',
			stdout: finalLine,
			stderr: stderrChunks.join( '' ),
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
