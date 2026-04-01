/**
 * Importer Child Process
 *
 * Runs importer.phar via PHP WASM in an isolated child process so that
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

interface ImporterMount {
	hostPath: string;
	vfsPath: string;
}

interface RunMessage {
	type: 'run';
	pharPath: string;
	stateDir: string;
	docroot: string;
	tmpDir: string;
	args: string[];
	mounts?: ImporterMount[];
}

type ImporterChildMessage =
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

async function mountDirectory( php: PHP, mount: ImporterMount ) {
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
			await sendAndFlush( { type, chunk } satisfies ImporterChildMessage );
		}
	} finally {
		const remaining = decoder.decode();
		if ( remaining ) {
			buffer.push( remaining );
			await sendAndFlush( { type, chunk: remaining } satisfies ImporterChildMessage );
		}
		reader.releaseLock();
	}
}

async function runImporter( msg: RunMessage ) {
	const { pharPath, stateDir, docroot, tmpDir, args, mounts = [] } = msg;

	const id = await loadNodeRuntime( LatestSupportedPHPVersion, {
		followSymlinks: true,
		emscriptenOptions: {
			processId: processIdAllocator.claim(),
		},
	} );
	const php = new PHP( id );

	try {
		await php.setSapiName( 'cli' );

		await mountDirectory( php, { hostPath: stateDir, vfsPath: '/state' } );
		await mountDirectory( php, { hostPath: docroot, vfsPath: '/docroot' } );
		await mountDirectory( php, { hostPath: tmpDir, vfsPath: '/tmp' } );

		for ( const mount of mounts ) {
			await mountDirectory( php, mount );
		}

		await php.mount( '/tmp/importer.phar', createNodeFsMountHandler( pharPath ) );

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

		const response = await php.cli( [ 'php', '/tmp/importer.phar', ...args ] );
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];

		const [ exitCode ] = await Promise.all( [
			response.exitCode,
			pipePhpStream( response.stdout, 'stdout', stdoutChunks ),
			pipePhpStream( response.stderr, 'stderr', stderrChunks ),
		] );

		await sendAndFlush( {
			type: 'result',
			stdout: stdoutChunks.join( '' ),
			stderr: stderrChunks.join( '' ),
			exitCode,
		} satisfies ImporterChildMessage );
	} catch ( error ) {
		await sendAndFlush( {
			type: 'error',
			message: error instanceof Error ? error.message : String( error ),
		} satisfies ImporterChildMessage );
	}

	php.exit();
}

process.on( 'message', async ( msg: RunMessage ) => {
	if ( msg.type !== 'run' ) {
		return;
	}

	try {
		await runImporter( msg );
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
