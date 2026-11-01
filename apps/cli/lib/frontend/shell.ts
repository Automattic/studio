import os from 'os';
import path from 'path';

export interface ShellInvocation {
	file: string;
	args: string[];
	windowsVerbatimArguments?: boolean;
}

export function getUserShell(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform
): string {
	if ( platform === 'win32' ) {
		return env.ComSpec || env.COMSPEC || 'cmd.exe';
	}
	if ( env.SHELL ) {
		return env.SHELL;
	}
	try {
		const { shell } = os.userInfo();
		if ( shell ) {
			return shell;
		}
	} catch {
		// No passwd entry; fall through to the platform default.
	}
	return platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

/**
 * How to run `command` the way the user's terminal would: through their login
 * shell on POSIX (so nvm, volta, fnm and Homebrew put `node` on PATH), and
 * through `cmd.exe` on Windows. `interactive` also loads the shell's rc file
 * (`.zshrc`, `.bashrc`), where nvm is usually set up; it is only used for
 * short probes, never for the long-running dev server.
 */
export function buildShellInvocation(
	command: string,
	options: { platform?: NodeJS.Platform; shell?: string; interactive?: boolean } = {}
): ShellInvocation {
	const platform = options.platform ?? process.platform;
	const shell = options.shell ?? getUserShell( process.env, platform );
	if ( platform === 'win32' ) {
		return {
			file: shell,
			args: [ '/d', '/s', '/c', `"${ command }"` ],
			windowsVerbatimArguments: true,
		};
	}
	return { file: shell, args: [ options.interactive ? '-ilc' : '-lc', command ] };
}

const DETECTION_BEGIN = '__STUDIO_NODE_BEGIN__';
const DETECTION_END = '__STUDIO_NODE_END__';

// Valid in sh, bash, zsh and fish. Markers fence the output off from anything
// the user's profile prints.
export function getNodeDetectionScript( platform: NodeJS.Platform = process.platform ): string {
	if ( platform === 'win32' ) {
		return `echo ${ DETECTION_BEGIN }& where node& node -v& where npm& echo ${ DETECTION_END }`;
	}
	return `echo ${ DETECTION_BEGIN }; command -v node; node -v; command -v npm; echo ${ DETECTION_END }`;
}

export interface DetectedNode {
	nodePath: string;
	version: string;
	npmPath?: string;
}

function isAbsoluteAnyPlatform( value: string ): boolean {
	return path.posix.isAbsolute( value ) || path.win32.isAbsolute( value );
}

function binaryName( value: string ): string {
	return path.win32.basename( path.posix.basename( value ) ).toLowerCase();
}

export function parseNodeDetectionOutput( stdout: string ): DetectedNode | undefined {
	const begin = stdout.lastIndexOf( DETECTION_BEGIN );
	if ( begin === -1 ) {
		return undefined;
	}
	const endIndex = stdout.indexOf( DETECTION_END, begin );
	const section = stdout.slice(
		begin + DETECTION_BEGIN.length,
		endIndex === -1 ? undefined : endIndex
	);
	const lines = section
		.split( /\r?\n/ )
		.map( ( line ) => line.trim() )
		.filter( Boolean );

	const absolutePaths = lines.filter( isAbsoluteAnyPlatform );
	const nodePath = absolutePaths.find( ( line ) =>
		[ 'node', 'node.exe' ].includes( binaryName( line ) )
	);
	const version = lines.find( ( line ) => /^v\d+\.\d+\.\d+/.test( line ) );
	if ( ! nodePath || ! version ) {
		return undefined;
	}
	const npmPath = absolutePaths.find( ( line ) =>
		[ 'npm', 'npm.cmd', 'npm.exe' ].includes( binaryName( line ) )
	);
	return { nodePath, version, ...( npmPath ? { npmPath } : {} ) };
}

export function getNodeMajorVersion( version: string ): number | undefined {
	const match = /^v?(\d+)\./.exec( version.trim() );
	return match ? Number( match[ 1 ] ) : undefined;
}

function findPathKey( env: NodeJS.ProcessEnv ): string {
	return Object.keys( env ).find( ( key ) => key.toUpperCase() === 'PATH' ) ?? 'PATH';
}

export function prependToPath(
	env: NodeJS.ProcessEnv,
	directory: string,
	platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
	const key = findPathKey( env );
	const delimiter = platform === 'win32' ? ';' : ':';
	const current = env[ key ];
	const entries = current ? current.split( delimiter ) : [];
	if ( entries.includes( directory ) ) {
		return env;
	}
	return { ...env, [ key ]: [ directory, ...entries ].join( delimiter ) };
}
