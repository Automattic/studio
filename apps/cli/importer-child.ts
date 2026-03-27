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

async function mountDirectory( php: PHP, mount: ImporterMount ) {
	php.mkdir( mount.vfsPath );
	await php.mount( mount.vfsPath, createNodeFsMountHandler( mount.hostPath ) );
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
