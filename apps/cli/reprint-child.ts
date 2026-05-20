/**
 * Reprint Child Process
 *
 * Runs reprint.phar via PHP WASM in an isolated child process so that
 * the parent's event loop stays responsive for Ctrl+C handling and
 * progress reporting. The parent communicates via IPC messages.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { rootCertificates } from 'node:tls';
import { createNodeFsMountHandler, loadNodeRuntime, withNetworking } from '@php-wasm/node';
import { PHP, ProcessIdAllocator, setPhpIniEntries } from '@php-wasm/universal';
import { createSpawnHandler } from '@php-wasm/util';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';

const processIdAllocator = new ProcessIdAllocator();
const REPRINT_PHP_VERSION = '8.4' satisfies SupportedPHPVersion;
const WASM_EXTENSIONS_DIR = path.join( import.meta.dirname, 'wasm-extensions' );
const REQUIRED_EXTENSION_MANIFESTS = [
	path.join( WASM_EXTENSIONS_DIR, 'wp_native_apis', 'manifest.json' ),
	path.join( WASM_EXTENSIONS_DIR, 'wp_mysql_parser', 'manifest.json' ),
] as const;

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

function assertExtensionManifestsExist() {
	const missing = REQUIRED_EXTENSION_MANIFESTS.filter(
		( manifestPath ) => ! existsSync( manifestPath )
	);
	if ( missing.length > 0 ) {
		throw new Error(
			`Missing bundled PHP WASM extension manifest(s): ${ missing.join(
				', '
			) }. Rebuild the Studio CLI so pull-reprint can load its native extensions.`
		);
	}
}

function createRequiredExtensionOptions() {
	assertExtensionManifestsExist();

	return REQUIRED_EXTENSION_MANIFESTS.map( ( manifestUrl ) => ( {
		source: {
			format: 'manifest' as const,
			manifestUrl,
		},
	} ) );
}

function writeNativeExtensionAssertion( php: PHP ) {
	php.writeFile(
		'/tmp/assert-native-reprint-extensions.php',
		`<?php
$missing = array();
foreach ( array( 'wp_native_apis', 'wp_mysql_parser' ) as $extension ) {
	if ( ! extension_loaded( $extension ) ) {
		$missing[] = "extension_loaded('{$extension}')";
	}
}

foreach (
	array(
		'WP_HTML_Native_Tag_Processor',
		'WP_HTML_Native_Processor',
		'WordPress\\\\XML\\\\NativeXMLProcessor',
		'WordPress\\\\DataLiberation\\\\URL\\\\NativeURLInTextProcessor',
		'WP_MySQL_Native_Grammar',
		'WP_MySQL_Native_Lexer',
		'WP_MySQL_Native_Parser',
		'WP_MySQL_Native_Token_Stream',
	) as $class_name
) {
	if ( ! class_exists( $class_name, false ) ) {
		$missing[] = "class_exists('{$class_name}')";
	}
}

if ( $missing ) {
	fwrite(
		STDERR,
		"pull-reprint expected native PHP WASM extensions, but these checks failed: " .
		implode( ', ', $missing ) .
		". This would silently fall back to much slower PHP parsing, so Studio is aborting.\\n"
	);
	exit( 1 );
}
`
	);
}

/**
 * Pipes a PHP stream to the parent process via IPC, calling `onChunk`
 * for each decoded text fragment so the caller can track whatever
 * summary it needs (last line, tail bytes, etc.) without accumulating
 * the full stream in memory.
 */
async function pipePhpStream(
	stream: ReadableStream< Uint8Array >,
	type: 'stdout' | 'stderr',
	onChunk: ( chunk: string ) => void
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

			onChunk( chunk );
			await sendAndFlush( { type, chunk } satisfies ReprintChildMessage );
		}
	} finally {
		const remaining = decoder.decode();
		if ( remaining ) {
			onChunk( remaining );
			await sendAndFlush( { type, chunk: remaining } satisfies ReprintChildMessage );
		}
		reader.releaseLock();
	}
}

async function runReprint( msg: RunMessage ) {
	const { pharPath, stateDir, fsRoot, tmpDir, args, mounts = [] } = msg;

	const id = await loadNodeRuntime( REPRINT_PHP_VERSION, {
		followSymlinks: true,
		extensions: createRequiredExtensionOptions(),
		emscriptenOptions: await withNetworking( {
			processId: processIdAllocator.claim(),
		} ),
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
		writeNativeExtensionAssertion( php );
		await setPhpIniEntries( php, {
			'openssl.cafile': '/tmp/ca-bundle.crt',
			auto_prepend_file: '/tmp/assert-native-reprint-extensions.php',
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

		// reprint emits JSON-L progress on stdout (thousands of lines) and
		// can emit megabytes of PHP warnings on stderr. We only need the
		// last stdout line (the result envelope) and the stderr tail for
		// diagnostics, so both trackers avoid accumulating the full stream.
		let lastStdoutLine = '';
		let stdoutRemainder = '';
		const STDERR_TAIL_BYTES = 256 * 1024;
		let stderrTail = '';

		const [ exitCode ] = await Promise.all( [
			response.exitCode,
			pipePhpStream( response.stdout, 'stdout', ( chunk ) => {
				const combined = stdoutRemainder + chunk;
				const lines = combined.split( '\n' );
				stdoutRemainder = lines.pop() ?? '';
				for ( let i = lines.length - 1; i >= 0; i-- ) {
					if ( lines[ i ].trim() ) {
						lastStdoutLine = lines[ i ];
						break;
					}
				}
			} ),
			pipePhpStream( response.stderr, 'stderr', ( chunk ) => {
				stderrTail += chunk;
				if ( stderrTail.length > STDERR_TAIL_BYTES ) {
					stderrTail = stderrTail.slice( stderrTail.length - STDERR_TAIL_BYTES );
				}
			} ),
		] );

		await sendAndFlush( {
			type: 'result',
			stdout: stdoutRemainder.trim() || lastStdoutLine,
			stderr: stderrTail,
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
