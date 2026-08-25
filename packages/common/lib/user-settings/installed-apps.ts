import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SUPPORTED_EDITORS, supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { SUPPORTED_TERMINALS, terminalConfig } from '@studio/common/lib/user-settings/terminal';
import type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';

/** Detect which editors and terminals are installed on this machine. */

export type AppKey = SupportedEditor | SupportedTerminal;
export type InstalledApps = Record< AppKey, boolean >;

type PlatformPaths = {
	[ K in AppKey ]: string[];
};

// Resolve a command on $PATH (an executable regular file), used on Linux where
// editors/terminals live in many places (apt, snap, flatpak, ~/.local/bin…).
function findOnPath( command: string ): string | null {
	const pathEntries = ( process.env.PATH ?? '' ).split( path.posix.delimiter ).filter( Boolean );
	for ( const dir of pathEntries ) {
		const candidate = path.posix.join( dir, command );
		try {
			if ( ! fs.statSync( candidate ).isFile() ) {
				continue;
			}
			fs.accessSync( candidate, fs.constants.X_OK );
			return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

function getProgramFilesPath(): string {
	if ( process.platform !== 'win32' ) {
		return 'C:\\Program Files';
	}
	return process.env.ProgramFiles || 'C:\\Program Files';
}

function getLocalProgramsPath(): string {
	if ( process.platform !== 'win32' ) {
		return os.homedir();
	}
	const localAppData = process.env.LOCALAPPDATA;
	if ( localAppData ) {
		return path.win32.join( localAppData, 'Programs' );
	}
	return path.win32.join( os.homedir(), 'AppData', 'Local', 'Programs' );
}

// Installation paths for each editor/terminal by platform. Linux editors and
// terminals are detected via `$PATH` (see `isInstalled`), so those entries are
// intentionally empty here.
const installationPaths: Record< string, PlatformPaths > = {
	darwin: {
		antigravity: [ 'Antigravity.app' ],
		vscode: [ 'Visual Studio Code.app' ],
		phpstorm: [ 'PhpStorm.app' ],
		cursor: [ 'Cursor.app' ],
		windsurf: [ 'Windsurf.app' ],
		webstorm: [ 'WebStorm.app' ],
		sublime: [ 'Sublime Text.app' ],
		zed: [ 'Zed.app' ],
		iterm: [ 'iTerm.app' ],
		terminal: [ 'Terminal.app' ],
		warp: [ 'Warp.app' ],
		ghostty: [ 'Ghostty.app' ],
	},
	linux: {
		antigravity: [],
		vscode: [],
		phpstorm: [],
		cursor: [],
		windsurf: [],
		webstorm: [],
		sublime: [],
		zed: [],
		iterm: [],
		terminal: [],
		warp: [],
		ghostty: [],
	},
	win32: {
		antigravity: [
			path.win32.join( getLocalProgramsPath(), 'Antigravity' ),
			path.win32.join( getProgramFilesPath(), 'Google\\Antigravity' ),
		],
		vscode: [
			path.win32.join( getProgramFilesPath(), 'Microsoft VS Code' ),
			path.win32.join( getLocalProgramsPath(), 'Microsoft VS Code' ),
		],
		phpstorm: [
			path.win32.join( getProgramFilesPath(), 'JetBrains\\PhpStorm' ),
			path.win32.join( getLocalProgramsPath(), 'PhpStorm' ),
		],
		cursor: [
			path.win32.join( getProgramFilesPath(), 'Cursor' ),
			path.win32.join( getLocalProgramsPath(), 'cursor' ),
		],
		windsurf: [
			path.win32.join( getProgramFilesPath(), 'Windsurf' ),
			path.win32.join( getLocalProgramsPath(), 'Windsurf' ),
		],
		webstorm: [
			path.win32.join( getProgramFilesPath(), 'JetBrains\\WebStorm' ),
			path.win32.join( getLocalProgramsPath(), 'WebStorm' ),
		],
		sublime: [
			path.win32.join( getProgramFilesPath(), 'Sublime Text' ),
			path.win32.join( getProgramFilesPath(), 'Sublime Text 4' ),
			path.win32.join( getProgramFilesPath(), 'Sublime Text 3' ),
		],
		zed: [ path.win32.join( getLocalProgramsPath(), 'Zed' ) ],
		iterm: [],
		terminal: [],
		warp: [
			path.win32.join( getLocalProgramsPath(), 'Warp' ),
			path.win32.join( getProgramFilesPath(), 'Warp' ),
		],
		ghostty: [],
	},
};

if ( process.platform === 'darwin' ) {
	const systemApplications = '/Applications';
	const userApplications = path.join( os.homedir(), 'Applications' );

	Object.keys( installationPaths.darwin ).forEach( ( ide ) => {
		const appName = installationPaths.darwin[ ide as AppKey ][ 0 ];
		if ( appName ) {
			installationPaths.darwin[ ide as AppKey ] = [
				path.join( systemApplications, appName ),
				path.join( userApplications, appName ),
			];
		}
	} );
} else if ( process.platform === 'win32' ) {
	// For JetBrains IDEs, check for version-specific folders.
	[ 'phpstorm', 'webstorm' ].forEach( ( ide ) => {
		const basePaths = installationPaths.win32[ ide as AppKey ];
		const jetbrainsDir = path.win32.join( getProgramFilesPath(), 'JetBrains' );

		if ( fs.existsSync( jetbrainsDir ) ) {
			const entries = fs.readdirSync( jetbrainsDir );
			entries.forEach( ( entry ) => {
				if ( entry.toLowerCase().includes( ide ) ) {
					basePaths.push( path.win32.join( jetbrainsDir, entry ) );
				}
			} );
		}
	} );
}

function isSupportedEditor( key: AppKey ): key is SupportedEditor {
	return ( SUPPORTED_EDITORS as readonly string[] ).includes( key );
}

function isSupportedTerminal( key: AppKey ): key is SupportedTerminal {
	return ( SUPPORTED_TERMINALS as readonly string[] ).includes( key );
}

export function isInstalled( key: AppKey ): boolean {
	const platform = process.platform;

	// On Linux, resolve editors/terminals against $PATH via their `linuxCommands`.
	if ( platform === 'linux' ) {
		if ( isSupportedEditor( key ) ) {
			return supportedEditorConfig[ key ].linuxCommands.some(
				( command ) => findOnPath( command ) !== null
			);
		}
		if ( isSupportedTerminal( key ) ) {
			return terminalConfig[ key ].linuxCommands.some(
				( command ) => findOnPath( command ) !== null
			);
		}
	}

	const paths = installationPaths[ platform ]?.[ key ];
	return ( paths ?? [] ).some( ( pathStr: string ) => pathStr && fs.existsSync( pathStr ) );
}

// All editors + terminals with their installed state. The system terminal is
// always considered present (macOS Terminal.app lives outside /Applications,
// Windows always has Command Prompt).
export function detectInstalledApps(): InstalledApps {
	const apps = {} as InstalledApps;
	for ( const key of [ ...SUPPORTED_EDITORS, ...SUPPORTED_TERMINALS ] as AppKey[] ) {
		apps[ key ] = key === 'terminal' ? true : isInstalled( key );
	}
	return apps;
}

// What an unset editor preference resolves to, shared so the desktop and the
// `studio ui` server offer the same fallback.
export function getFirstInstalledEditor( installedApps: InstalledApps ): SupportedEditor | null {
	return SUPPORTED_EDITORS.find( ( editor ) => installedApps[ editor ] ) ?? null;
}
