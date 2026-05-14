import fs from 'fs';
import { rootCertificates } from 'node:tls';
import os from 'os';
import path from 'path';
import { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';
import { getPhpBinaryPath } from './dependency-management/paths';

// Disabled by default to shrink the attack surface available to PHP code
// running inside a Studio site. Each entry falls into one of:
//   - Code execution / loading native code: dl, exec, passthru, popen,
//     proc_open/close/terminate, shell_exec, system, pcntl_exec, pcntl_fork
//   - Signal & scheduling control (DoS / handler hijack): pcntl_alarm,
//     pcntl_async_signals, pcntl_sig*, pcntl_*priority, proc_nice, posix_kill
//   - Privilege change: posix_set*
//   - Inbound networking (binding listening sockets): socket_accept/bind/
//     listen/create_listen/create_pair, stream_socket_server
//   - Filesystem tricks that can escape open_basedir or create odd
//     primitives: link, symlink, posix_mkfifo
//   - Source disclosure: show_source
const PHP_DEFAULT_DISABLED_FUNCTIONS = [
	'dl',
	'exec',
	'link',
	'passthru',
	'pcntl_alarm',
	'pcntl_async_signals',
	'pcntl_exec',
	'pcntl_fork',
	'pcntl_getpriority',
	'pcntl_setpriority',
	'pcntl_signal',
	'pcntl_signal_dispatch',
	'pcntl_signal_get_handler',
	'pcntl_sigprocmask',
	'pcntl_sigtimedwait',
	'pcntl_sigwaitinfo',
	'popen',
	'posix_kill',
	'posix_mkfifo',
	'posix_setegid',
	'posix_seteuid',
	'posix_setgid',
	'posix_setpgid',
	'posix_setsid',
	'posix_setuid',
	'proc_close',
	'proc_nice',
	'proc_open',
	'proc_terminate',
	'shell_exec',
	'show_source',
	'socket_accept',
	'socket_bind',
	'socket_create_listen',
	'socket_create_pair',
	'socket_listen',
	'stream_socket_server',
	'symlink',
	'system',
] as const;

// Extensions to enable on Windows via `-d extension=<name>`. Computed as the
// intersection of two sets:
//   1. php_*.dll files that ship as separate DLLs in windows.php.net's
//      prebuilt zip (plus the PECL DLLs the workflow overlays: apcu, igbinary,
//      redis, ssh2, yaml). Everything else from the macOS list is baked into
//      php.exe itself (bcmath, calendar, ctype, dom, filter, iconv, mbregex,
//      mysqlnd, pdo, phar, session, simplexml, tokenizer, xml*, zlib) and
//      would emit "Module already loaded" warnings if we tried to enable it
//      with `extension=`.
//   2. The curated macOS extension list in .github/workflows/build-php-cli-binaries.yml.
//      windows.php.net also ships bz2, com_dotnet, enchant, ffi, gmp, ldap,
//      odbc, pdo_firebird, pdo_odbc, pdo_pgsql, pgsql, snmp, soap, sysvshm,
//      and tidy, but Studio doesn't ship those on macOS, so we don't enable
//      them on Windows either to keep behavior symmetric.
// opcache and xdebug are Zend extensions and loaded separately via
// `zend_extension=` (the latter only when config.enableXdebug is true). On
// macOS every extension is baked into the `php` binary by static-php-cli, so
// this list is irrelevant there.
const WINDOWS_PHP_EXTENSIONS = [
	'apcu',
	'curl',
	'dba',
	'exif',
	'fileinfo',
	'ftp',
	'gd',
	'gettext',
	'igbinary',
	'intl',
	'mbstring',
	'mysqli',
	'openssl',
	'pdo_mysql',
	'pdo_sqlite',
	'redis',
	'shmop',
	'sockets',
	'sodium',
	'sqlite3',
	'ssh2',
	'xsl',
	'yaml',
	'zip',
] as const;

const CA_BUNDLE_FILENAME = 'ca-bundle.crt';

function getExtensionDir( phpVersion: NativePhpSupportedVersion ): string {
	return path.join( path.dirname( getPhpBinaryPath( phpVersion ) ), 'ext' );
}

function toPhpIniPath( filePath: string ): string {
	return filePath.replace( /\\/g, '/' ).replace( /"/g, '\\"' );
}

export function getNativePhpCaBundlePath( phpIniDirectory: string ): string {
	return path.join( phpIniDirectory, CA_BUNDLE_FILENAME );
}

export function getNativePhpCaBundleArgs( caBundlePath: string ): string[] {
	const normalizedCaBundlePath = toPhpIniPath( caBundlePath );
	return [
		'-d',
		`openssl.cafile="${ normalizedCaBundlePath }"`,
		'-d',
		`curl.cainfo="${ normalizedCaBundlePath }"`,
	];
}

export function getNativePhpSubprocessIniContents(
	phpVersion: NativePhpSupportedVersion,
	caBundlePath?: string
): string {
	const directives = [ 'memory_limit=512M' ];

	if ( process.platform === 'win32' ) {
		directives.push( `extension_dir="${ toPhpIniPath( getExtensionDir( phpVersion ) ) }"` );
		for ( const extension of WINDOWS_PHP_EXTENSIONS ) {
			directives.push( `extension=${ extension }` );
		}
	}

	if ( caBundlePath ) {
		directives.push(
			`openssl.cafile="${ toPhpIniPath( caBundlePath ) }"`,
			`curl.cainfo="${ toPhpIniPath( caBundlePath ) }"`
		);
	}

	return `${ directives.join( os.EOL ) }${ os.EOL }`;
}

// blueprints.phar spawns its own PHP subprocesses while applying a blueprint.
// Those subprocesses inherit PHPRC but not the parent process's `-d` argv, so
// this php.ini carries the bundled extension and CA settings they need.
export async function createNativePhpSubprocessIniDirectory(
	phpVersion: NativePhpSupportedVersion
): Promise< string > {
	const tempRoot =
		process.platform === 'win32' ? fs.realpathSync.native( os.tmpdir() ) : os.tmpdir();
	const phpIniDirectory = await fs.promises.mkdtemp( path.join( tempRoot, 'studio-native-php-' ) );
	const caBundlePath = getNativePhpCaBundlePath( phpIniDirectory );
	await fs.promises.writeFile( caBundlePath, rootCertificates.join( os.EOL ), 'utf8' );
	await fs.promises.writeFile(
		path.join( phpIniDirectory, 'php.ini' ),
		getNativePhpSubprocessIniContents( phpVersion, caBundlePath ),
		'utf8'
	);
	return phpIniDirectory;
}

function getXdebugFilename(): string {
	return process.platform === 'win32' ? 'php_xdebug.dll' : 'xdebug.so';
}

// Process-scoped opcache dir, created lazily and removed when the process exits
let opcacheRootDir: string | null = null;

function getOpcacheRootDir(): string {
	if ( opcacheRootDir ) {
		return opcacheRootDir;
	}

	// Resolve to the long-form path on Windows. `os.tmpdir()` can return an 8.3
	// short name (e.g. C:\Users\BUILDK~1\AppData\…) when the user has a long
	// username, and PHP's INI scanner treats `~` as a special token, breaking
	// `-d opcache.file_cache=<path>` parsing.
	const tmpRoot =
		process.platform === 'win32' ? fs.realpathSync.native( os.tmpdir() ) : os.tmpdir();
	opcacheRootDir = fs.mkdtempSync( path.join( tmpRoot, 'studio-opcache-' ) );
	const dirToClean = opcacheRootDir;
	process.once( 'exit', () => {
		try {
			fs.rmSync( dirToClean, { recursive: true, force: true } );
		} catch {
			// Best effort. The OS will reap tmp eventually.
		}
	} );
	return opcacheRootDir;
}

export function getDefaultPhpArgs(
	phpVersion: NativePhpSupportedVersion,
	openBasedir: string[] = [],
	disallowRiskyFunctions: boolean = false,
	enableXdebug: boolean = false
): string[] {
	// Partition the file_cache by PHP version: opcache's on-disk script blob
	// format isn't stable across minor versions, and reusing a cache populated
	// by a different PHP can crash the server at startup on Windows.
	const cacheId = `php${ phpVersion }`;
	const cacheDirectory = path.join( getOpcacheRootDir(), cacheId );
	fs.mkdirSync( cacheDirectory, { recursive: true } );

	const args = [
		// Avoid loading php.ini config files to prevent other PHP installations from affecting Studio
		'-n',
		'-d',
		'memory_limit=512M',
		'-d',
		`opcache.file_cache="${ cacheDirectory }"`,
		'-d',
		`opcache.cache_id="studio-${ cacheId }"`,
	];

	const extensionDir = getExtensionDir( phpVersion );

	if ( process.platform === 'win32' ) {
		// Load every bundled DLL from the artifact's ext/ directory.
		// windows.php.net's prebuilt php.exe doesn't auto-load extensions;
		// each one needs an explicit `extension=` (or `zend_extension=` for
		// opcache) directive.
		args.push( '-d', `extension_dir="${ extensionDir }"` );
		args.push( '-d', `zend_extension=opcache` );
		for ( const extension of WINDOWS_PHP_EXTENSIONS ) {
			args.push( '-d', `extension=${ extension }` );
		}
	}

	if ( enableXdebug ) {
		// On macOS the `php` binary has every other extension baked in and ext/
		// contains only xdebug.so; on Windows extension_dir is already set
		// above. Either way the Zend extension path is ext/<filename>.
		if ( process.platform !== 'win32' ) {
			args.push( '-d', `extension_dir="${ extensionDir }"` );
		}
		args.push(
			'-d',
			`zend_extension="${ path.join( extensionDir, getXdebugFilename() ) }"`,
			'-d',
			'xdebug.mode=debug'
		);
	}

	if ( openBasedir.length ) {
		args.push( '-d', `open_basedir="${ openBasedir.join( path.delimiter ) }"` );
	}

	if ( disallowRiskyFunctions ) {
		args.push( '-d', `disable_functions=${ PHP_DEFAULT_DISABLED_FUNCTIONS.join( ',' ) }` );
	}

	return args;
}
