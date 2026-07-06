import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';

/**
 * The browser can't touch the filesystem, but the local server runs on the
 * user's own machine, so "open in Finder / editor / terminal" still works — the
 * server just delegates to the OS instead of Electron's `shell`. The launch
 * targets (bundle IDs, $PATH commands, Windows paths) come from the same shared
 * `@studio/common/lib/user-settings` config the desktop uses; only the syscall
 * differs (Electron `shell.openPath` → `child_process`), the same runtime seam
 * as IPC-vs-HTTP. App DETECTION is shared (`installed-apps.ts`); this file is
 * only the launch side. macOS is exercised by `studio ui`; the Windows/Linux
 * branches mirror the desktop handlers but aren't covered here.
 */

const execFileAsync = promisify( execFile );

// macOS bundle IDs for terminals (editors carry theirs in the shared config).
const MACOS_TERMINAL_BUNDLE_IDS: Record< SupportedTerminal, string > = {
	warp: 'dev.warp.Warp-Stable',
	ghostty: 'com.mitchellh.ghostty',
	iterm: 'com.googlecode.iterm2',
	terminal: 'com.apple.Terminal',
};

export function isEditor( key: string ): key is SupportedEditor {
	return ( SUPPORTED_EDITORS as readonly string[] ).includes( key );
}

export function isTerminal( key: string ): key is SupportedTerminal {
	return ( SUPPORTED_TERMINALS as readonly string[] ).includes( key );
}

function existsOnPath( command: string ): boolean {
	const dirs = ( process.env.PATH ?? '' ).split( path.delimiter ).filter( Boolean );
	return dirs.some( ( dir ) => existsSync( path.join( dir, command ) ) );
}

function expandWinEnv( p: string ): string {
	return p.replace( /%([^%]+)%/g, ( _m, name ) => process.env[ name ] ?? '' );
}

async function openUrl( url: string ): Promise< void > {
	if ( process.platform === 'darwin' ) {
		await execFileAsync( 'open', [ url ] );
	} else if ( process.platform === 'win32' ) {
		await execFileAsync( 'cmd', [ '/c', 'start', '""', url ] );
	} else {
		await execFileAsync( 'xdg-open', [ url ] );
	}
}

// Open a path in the OS file manager (the desktop's Electron `shell.openPath`).
export async function openPath( target: string ): Promise< void > {
	if ( process.platform === 'darwin' ) {
		await execFileAsync( 'open', [ target ] );
		return;
	}
	if ( process.platform === 'win32' ) {
		// explorer.exe returns a non-zero exit code even on success.
		await execFileAsync( 'explorer', [ target ] ).catch( () => undefined );
		return;
	}
	await execFileAsync( 'xdg-open', [ target ] );
}

export async function openInEditor( editor: SupportedEditor, target: string ): Promise< void > {
	const config = supportedEditorConfig[ editor ];
	if ( process.platform === 'darwin' ) {
		await execFileAsync( 'open', [ '-b', config.macOSBundleId, target ] );
		return;
	}
	if ( process.platform === 'linux' ) {
		const command = config.linuxCommands.find( ( c ) => existsOnPath( c ) );
		if ( command ) {
			await execFileAsync( command, [ target ] );
			return;
		}
	}
	if ( process.platform === 'win32' ) {
		const exe = config.winPaths.map( expandWinEnv ).find( ( p ) => existsSync( p ) );
		if ( exe ) {
			await execFileAsync( exe, [ target ] );
			return;
		}
	}
	// Fall back to the editor's URL scheme via the OS opener.
	await openUrl( config.url( target ) );
}

export async function openInTerminal(
	terminal: SupportedTerminal,
	target: string
): Promise< void > {
	if ( process.platform === 'darwin' ) {
		await execFileAsync( 'open', [ '-b', MACOS_TERMINAL_BUNDLE_IDS[ terminal ], target ] );
		return;
	}
	if ( process.platform === 'win32' ) {
		await execFileAsync(
			'cmd',
			[ '/c', 'start', 'Command Prompt', process.env.ComSpec || 'cmd.exe' ],
			{
				cwd: target,
			}
		);
		return;
	}
	// Linux: prefer the chosen terminal's command, falling back to gnome-terminal.
	const command = terminalConfig[ terminal ].linuxCommands.find( ( c ) => existsOnPath( c ) );
	if ( command === 'warp-terminal' ) {
		await execFileAsync( command, [], { cwd: target } );
	} else {
		await execFileAsync( command ?? 'gnome-terminal', [ `--working-directory=${ target }` ] );
	}
}
