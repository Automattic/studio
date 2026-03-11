/**
 * Importer Child Process
 *
 * Runs importer.phar via PHP WASM in an isolated child process so that
 * the parent's event loop stays responsive for Ctrl+C handling and
 * progress reporting. The parent communicates via IPC messages.
 *
 * Protocol:
 *   Parent → Child:  { type: 'run', stateDir, docroot, tmpDir, args }
 *   Child → Parent:  { type: 'result', stdout, stderr, exitCode }
 *   Child → Parent:  { type: 'error', message }
 */
import { rootCertificates } from 'node:tls';
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import { PHP, setPhpIniEntries, ProcessIdAllocator } from '@php-wasm/universal';
import { createSpawnHandler } from '@php-wasm/util';
import { LatestSupportedPHPVersion } from '@studio/common/types/php-versions';

const processIdAllocator = new ProcessIdAllocator();

function createNoopSpawnHandler() {
	return createSpawnHandler( async ( args, processApi ) => {
		await new Promise( ( resolve ) => setTimeout( resolve, 1 ) );
		processApi.exit( 1 );
	} );
}

function sendAndFlush( msg: Record< string, unknown > ): Promise< void > {
	return new Promise< void >( ( resolve ) => {
		process.send!( msg, () => resolve() );
	} );
}

interface RunMessage {
	type: 'run';
	pharPath: string;
	stateDir: string;
	docroot: string;
	tmpDir: string;
	args: string[];
}

async function runImporter( msg: RunMessage ) {
	const { pharPath, stateDir, docroot, tmpDir, args } = msg;

	const id = await loadNodeRuntime( LatestSupportedPHPVersion, {
		followSymlinks: true,
		emscriptenOptions: {
			processId: processIdAllocator.claim(),
		},
	} );
	const php = new PHP( id );

	// Collect the result or error BEFORE calling php.exit(), because
	// php.exit() terminates the process via process.exit().
	try {
		await php.setSapiName( 'cli' );

		php.mkdir( '/state' );
		await php.mount( '/state', createNodeFsMountHandler( stateDir ) );
		php.mkdir( '/docroot' );
		await php.mount( '/docroot', createNodeFsMountHandler( docroot ) );

		// Mount /tmp to a persistent host directory so that the
		// importer's batch files survive process restarts. Without
		// this, temp files like the download batch are lost when
		// php.exit() calls process.exit(), causing the importer to
		// re-download the same files on every resume iteration.
		await php.mount( '/tmp', createNodeFsMountHandler( tmpDir ) );
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

		const [ stdout, stderr, exitCode ] = await Promise.all( [
			response.stdoutText,
			response.stderrText,
			response.exitCode,
		] );

		await sendAndFlush( { type: 'result', stdout, stderr, exitCode } );
	} catch ( error ) {
		await sendAndFlush( {
			type: 'error',
			message: error instanceof Error ? error.message : String( error ),
		} );
	}

	// php.exit() calls process.exit() internally, so this must come
	// after the IPC message has been flushed.
	php.exit();
}

process.on( 'message', async ( msg: RunMessage ) => {
	if ( msg.type !== 'run' ) {
		return;
	}
	try {
		await runImporter( msg );
	} catch ( error ) {
		// Last resort — if something fails before PHP is even loaded
		try {
			await sendAndFlush( {
				type: 'error',
				message: error instanceof Error ? error.message : String( error ),
			} );
		} catch {
			// IPC channel may be closed
		}
		process.exit( 1 );
	}
} );
