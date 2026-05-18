import fs from 'fs';
import { rootCertificates } from 'node:tls';
import os from 'os';
import path from 'path';
import { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';
import { writeFile } from 'atomically';
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

// Extensions to enable on Windows via `extension=<name>` in php.ini. Computed
// as the intersection of two sets:
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

const PHP_INI_FILENAME = 'php.ini';
const CA_BUNDLE_FILENAME = 'ca-bundle.crt';

function getPhpBinaryDir( phpVersion: NativePhpSupportedVersion ): string {
	return path.dirname( getPhpBinaryPath( phpVersion ) );
}

function getExtensionDir( phpVersion: NativePhpSupportedVersion ): string {
	return path.join( getPhpBinaryDir( phpVersion ), 'ext' );
}

// PHP's INI parser on Windows accepts forward slashes inside quoted values
// and is fussy about backslashes (which also act as escape characters). Use
// forward slashes everywhere and escape stray double quotes.
function toPhpIniPath( filePath: string ): string {
	return filePath.replace( /\\/g, '/' ).replace( /"/g, '\\"' );
}

// Windows-only: php.exe ships without a baked-in extension set, so we generate
// a php.ini that loads every bundled DLL plus the Mozilla root CA bundle
export function getNativePhpIniContents( phpVersion: NativePhpSupportedVersion ): string {
	if ( process.platform !== 'win32' ) {
		throw new Error( 'php.ini is only generated on Windows' );
	}

	const binDir = getPhpBinaryDir( phpVersion );
	const directives = [
		'memory_limit=512M',
		`extension_dir="${ toPhpIniPath( getExtensionDir( phpVersion ) ) }"`,
		'zend_extension=opcache',
		...WINDOWS_PHP_EXTENSIONS.map( ( extension ) => `extension=${ extension }` ),
		`openssl.cafile="${ toPhpIniPath( path.join( binDir, CA_BUNDLE_FILENAME ) ) }"`,
		`curl.cainfo="${ toPhpIniPath( path.join( binDir, CA_BUNDLE_FILENAME ) ) }"`,
	];

	return `${ directives.join( os.EOL ) }${ os.EOL }`;
}

// Writes php.ini and ca-bundle.crt next to the PHP binary on Windows so every
// php.exe invocation — parent or child — loads the same config automatically.
// No-op on non-Windows platforms, where extensions are statically linked into
// the binary and config is passed via `-d` argv in getDefaultPhpArgs().
export async function ensureNativePhpIniFiles(
	phpVersion: NativePhpSupportedVersion
): Promise< void > {
	if ( process.platform !== 'win32' ) {
		return;
	}

	const binDir = getPhpBinaryDir( phpVersion );
	await writeFile( path.join( binDir, CA_BUNDLE_FILENAME ), rootCertificates.join( os.EOL ), {
		encoding: 'utf8',
	} );
	await writeFile( path.join( binDir, PHP_INI_FILENAME ), getNativePhpIniContents( phpVersion ), {
		encoding: 'utf8',
	} );
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

	const args: string[] = [];

	if ( process.platform === 'win32' ) {
		// `-c` points php.exe at our php.ini and short-circuits the default
		// ini search, so host PHP installations (and PHPRC) can't leak in —
		// the same isolation `-n` gives us on macOS/Linux. Our php.ini
		// carries memory_limit, extension_dir, every bundled extension, and
		// the Mozilla CA bundle paths; only opcache cache state and the
		// per-invocation knobs below need to be passed via `-d`.
		args.push( '-c', path.join( getPhpBinaryDir( phpVersion ), PHP_INI_FILENAME ) );
		args.push(
			'-d',
			`opcache.file_cache="${ cacheDirectory }"`,
			'-d',
			`opcache.cache_id="studio-${ cacheId }"`
		);
	} else {
		// On macOS/Linux every extension is statically linked into the binary,
		// so there is no php.ini next to it. Skip php.ini scanning with `-n`
		// to keep the host's PHP installation from leaking into Studio, then
		// pass the required runtime knobs explicitly.
		args.push(
			'-n',
			'-d',
			'memory_limit=512M',
			'-d',
			`opcache.file_cache="${ cacheDirectory }"`,
			'-d',
			`opcache.cache_id="studio-${ cacheId }"`
		);
	}

	if ( enableXdebug ) {
		// On macOS the `php` binary has every other extension baked in and ext/
		// contains only xdebug.so; on Windows extension_dir is already set in
		// php.ini. Either way the Zend extension path is ext/<filename>.
		if ( process.platform !== 'win32' ) {
			args.push( '-d', `extension_dir="${ getExtensionDir( phpVersion ) }"` );
		}
		args.push(
			'-d',
			`zend_extension="${ path.join( getExtensionDir( phpVersion ), getXdebugFilename() ) }"`,
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
