import fs from 'fs';
import { rootCertificates } from 'node:tls';
import os from 'os';
import path from 'path';
import { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';
import { writeFile } from 'atomically';
import semver from 'semver';
import { getPhpBinaryPath } from '../dependency-management/paths';
import { getFullyResolvedTmpDirPath } from './tmp-dir';

// Disabled to shrink the attack surface available to PHP code running inside a
// Studio site. Each entry falls into one of:
//   - Runtime native-code loading: dl (loads a native extension into the
//     interpreter — deprecated, unavailable in most SAPIs, never needed by a
//     real WP workload)
//   - Forking / replacing the worker process itself: pcntl_exec, pcntl_fork.
//     These mutate the PHP worker process rather than spawning a child
//     command; the legitimate "run an external command" use case is served by
//     the exec/proc_open family, which is intentionally NOT disabled (see
//     note below).
//   - Signal & scheduling control (DoS / handler hijack): pcntl_alarm,
//     pcntl_async_signals, pcntl_sig*, pcntl_*priority, proc_nice, posix_kill
//   - Privilege change: posix_set*
//   - Inbound networking (binding listening sockets): socket_accept/bind/
//     listen/create_listen/create_pair, stream_socket_server
//   - Filesystem tricks that can escape open_basedir or create odd
//     primitives: link, symlink, posix_mkfifo
//   - Source disclosure: show_source
//
// NOTE: the external-command-execution functions (exec, passthru, popen,
// proc_open/close/terminate, shell_exec, system) are deliberately left
// enabled. Blocking them broke too many plugins and tools that legitimately
// shell out (image processing, backups, git, etc.), so for the native PHP
// beta a site may run external commands like a normal local PHP install.
//
// WHAT THIS ACTUALLY BUYS US: this list and the open_basedir jail are
// in-process checks — they only constrain PHP's own C-level calls. Once the
// exec family is enabled, a child process runs as the OS user with none of
// these checks, so most entries here have trivial shell equivalents (open_
// basedir → `cat`/`cp`, symlink → `ln -s`, posix_kill → `kill`, socket_bind →
// `nc -l`, show_source → `cat`). The only entries a child process cannot
// replicate are the interpreter-level ones (dl, pcntl_fork, pcntl_exec,
// pcntl_signal*). So treat all of this as a guardrail that limits the blast
// radius of buggy or limited-primitive code — the common WP case (LFI, path
// traversal, arbitrary file read/delete that abuses a PHP file function and
// never shells out) is still genuinely contained by open_basedir — NOT as a
// sandbox against deliberately malicious plugins. Real confinement of the
// worker process tree (which survives exec) requires an OS-level sandbox.
const PHP_DEFAULT_DISABLED_FUNCTIONS = [
	'dl',
	'link',
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
	'posix_kill',
	'posix_mkfifo',
	'posix_setegid',
	'posix_seteuid',
	'posix_setgid',
	'posix_setpgid',
	'posix_setsid',
	'posix_setuid',
	'proc_nice',
	'show_source',
	'socket_accept',
	'socket_bind',
	'socket_create_listen',
	'socket_create_pair',
	'socket_listen',
	'stream_socket_server',
	'symlink',
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
// and is fussy about backslashes (which also act as escape characters).
// Handle both characters in a single pass: backslashes become forward slashes,
// and double-quotes are backslash-escaped. Using one replace() call avoids any
// ordering ambiguity — there is no intermediate state where a newly introduced
// backslash could interact with a not-yet-processed double-quote.
function toPhpIniPath( filePath: string ): string {
	return filePath.replace( /[\\"]/g, ( char ) => ( char === '\\' ? '/' : '\\"' ) );
}

function getNativePhpIniPath( phpVersion: NativePhpSupportedVersion ): string {
	return path.join( getPhpBinaryDir( phpVersion ), PHP_INI_FILENAME );
}

// Generates the contents of the php.ini that ships next to the bundled binary.
// All platforms get memory_limit, an opcache cache_id partitioned per PHP
// version (opcache's on-disk script blob format isn't stable across versions),
// and the Mozilla root CA bundle. Windows additionally needs extension_dir +
// every extension= and zend_extension=opcache. On macOS/Linux, this is not
// needed, as we link extensions into the PHP binary statically.
export function getNativePhpIniContents( phpVersion: NativePhpSupportedVersion ): string {
	const caBundlePath = toPhpIniPath(
		path.join( getPhpBinaryDir( phpVersion ), CA_BUNDLE_FILENAME )
	);
	const directives: string[] = [
		'memory_limit=512M',
		'post_max_size=2G',
		'upload_max_filesize=2G',
		'display_errors=1',
		'display_startup_errors=1',
		`opcache.cache_id="studio-php${ phpVersion }"`,
		`openssl.cafile="${ caBundlePath }"`,
		`curl.cainfo="${ caBundlePath }"`,
	];

	if ( process.platform === 'win32' ) {
		directives.push(
			`extension_dir="${ toPhpIniPath( getExtensionDir( phpVersion ) ) }"`,
			...WINDOWS_PHP_EXTENSIONS.map( ( extension ) => `extension=${ extension }` )
		);

		const coercedVersion = semver.coerce( phpVersion );
		// As of PHP 8.5, the OPcache extension is always bundled with PHP
		if ( coercedVersion && semver.lt( coercedVersion, '8.5.0' ) ) {
			directives.push( 'zend_extension=opcache' );
		}
	}

	return `${ directives.join( os.EOL ) }${ os.EOL }`;
}

// Writes php.ini and ca-bundle.crt next to the PHP binary so every invocation
// of the bundled binary — parent or child — loads the same config. Writes go
// through `atomically` so concurrent Studio processes (e.g. a CLI invocation
// while the daemon is already running) can't expose PHP to a half-written
// config.
export async function ensureNativePhpIniFiles(
	phpVersion: NativePhpSupportedVersion
): Promise< void > {
	const binDir = getPhpBinaryDir( phpVersion );
	await writeFile( path.join( binDir, CA_BUNDLE_FILENAME ), rootCertificates.join( os.EOL ), {
		encoding: 'utf8',
	} );
	await writeFile( getNativePhpIniPath( phpVersion ), getNativePhpIniContents( phpVersion ), {
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

	opcacheRootDir = fs.mkdtempSync( path.join( getFullyResolvedTmpDirPath(), 'studio-opcache-' ) );
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

type DefaultPhpArgsOptions = {
	openBasedir?: string[];
	disallowRiskyFunctions?: boolean;
	enableXdebug?: boolean;
	autoPrependFile?: string;
};

export function getDefaultPhpArgs(
	phpVersion: NativePhpSupportedVersion,
	{
		openBasedir = [],
		disallowRiskyFunctions = false,
		enableXdebug = false,
		autoPrependFile,
	}: DefaultPhpArgsOptions = {}
): string[] {
	// Partition the file_cache directory by PHP version to match the cache_id
	// already pinned in php.ini — opcache's on-disk script blob format isn't
	// stable across minor versions and reusing a cache populated by a different
	// PHP can crash the server at startup.
	const cacheDirectory = path.join( getOpcacheRootDir(), `php${ phpVersion }` );
	fs.mkdirSync( cacheDirectory, { recursive: true } );

	// `-c` points the binary at our php.ini and short-circuits the default
	// ini search, so host PHP installations (and PHPRC) can't leak in
	const args: string[] = [
		'-c',
		getNativePhpIniPath( phpVersion ),
		'-d',
		`opcache.file_cache="${ cacheDirectory }"`,
	];

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
			'xdebug.mode=debug',
			// Override Xdebug's default `trigger` mode
			// (https://xdebug.org/docs/all_settings#start_with_request):
			// enabling Xdebug for a site means every request starts debugging.
			'-d',
			'xdebug.start_with_request=yes'
		);
	}

	if ( openBasedir.length ) {
		args.push( '-d', `open_basedir="${ openBasedir.join( path.delimiter ) }"` );
	}

	if ( disallowRiskyFunctions ) {
		args.push( '-d', `disable_functions=${ PHP_DEFAULT_DISABLED_FUNCTIONS.join( ',' ) }` );
	}

	// Run a PHP file before the main script — used to inject reprint's generated
	// runtime.php (constants, SQLite loader, upload proxy) into imported sites
	// without modifying their wp-config.php.
	if ( autoPrependFile ) {
		args.push( '-d', `auto_prepend_file="${ toPhpIniPath( autoPrependFile ) }"` );
	}

	return args;
}
