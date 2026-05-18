import fs from 'fs';
import os from 'os';
import path from 'path';
import { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';

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
	disallowRiskyFunctions: boolean = false
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

	if ( openBasedir.length ) {
		args.push( '-d', `open_basedir="${ openBasedir.join( path.delimiter ) }"` );
	}

	if ( disallowRiskyFunctions ) {
		args.push( '-d', `disable_functions=${ PHP_DEFAULT_DISABLED_FUNCTIONS.join( ',' ) }` );
	}

	return args;
}
