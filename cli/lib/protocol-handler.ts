import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { __ } from '@wordpress/i18n';
import { PROTOCOL_PREFIX } from 'common/constants';
import plist from 'plist';
import { LoggerError } from 'cli/logger';

// Constants
const LSREGISTER_PATH =
	'/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const BUNDLE_ID_PREFIX = 'com.automattic.studio-cli-auth';

// Store registration state for cleanup
let protocolRegistrationPath: string | null = null;

// Store original protocol handler state for restoration
let originalHandlerState: {
	appPath: string;
	bundleId: string;
} | null = null;

/**
 * Register the CLI as the protocol handler, saving existing handlers for restoration
 * @param override - If true, will override existing protocol handlers. If false, will throw error if protocol already exists.
 */
export async function registerProtocolHandler( override: boolean = true ): Promise< void > {
	try {
		const defaultApp = await getDefaultApp( PROTOCOL_PREFIX );

		if ( defaultApp ) {
			if ( ! override ) {
				throw new LoggerError(
					__( 'Protocol already exists. Use override option to replace existing handlers.' )
				);
			}

			const originalBundleId = await getBundleIdFromApp( defaultApp );
			if ( originalBundleId ) {
				originalHandlerState = {
					appPath: defaultApp,
					bundleId: originalBundleId,
				};
			}
		}

		const platform = process.platform;
		switch ( platform ) {
			case 'darwin':
				await registerProtocolMacOS();
				break;
			case 'win32':
				await registerProtocolWindows();
				break;
			default:
				await registerProtocolLinux();
				break;
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}
		throw new LoggerError( __( 'Failed to register protocol handler' ), error );
	}
}

/**
 * Extract bundle ID from an app bundle
 * @param appPath - Path to the .app bundle
 * @returns The CFBundleIdentifier or null if not found
 */
export async function getBundleIdFromApp( appPath: string ): Promise< string | null > {
	try {
		const plistPath = path.join( appPath, 'Contents', 'Info.plist' );
		if ( ! fs.existsSync( plistPath ) ) {
			return null;
		}

		const plistContent = fs.readFileSync( plistPath, 'utf-8' );
		const plistObj = plist.parse( plistContent );

		// @ts-expect-error plist types are not complete.
		return plistObj.CFBundleIdentifier || null;
	} catch {
		return null;
	}
}

/**
 * Get the default app for a given protocol
 * Returns the app path if one exists, null otherwise
 */
export async function getDefaultApp( protocol: string ): Promise< string | null > {
	const platform = process.platform;

	try {
		switch ( platform ) {
			case 'darwin':
				return await getDefaultAppMacOS( protocol );
			case 'win32':
				return await getDefaultAppWindows( protocol );
			default:
				return await getDefaultAppLinux( protocol );
		}
	} catch {
		return null;
	}
}

/**
 * Unregister the CLI as the protocol handler and restore the original handler
 * Should be called after successful authentication to clean up
 */
export async function unregisterProtocolHandler(): Promise< void > {
	if ( protocolRegistrationPath && fs.existsSync( protocolRegistrationPath ) ) {
		if ( protocolRegistrationPath.endsWith( '.app' ) ) {
			await fs.promises.rm( protocolRegistrationPath, { recursive: true, force: true } );
		} else {
			await fs.promises.unlink( protocolRegistrationPath );
		}
		protocolRegistrationPath = null;
	}

	if ( originalHandlerState ) {
		try {
			if ( ! fs.existsSync( originalHandlerState.appPath ) ) {
				originalHandlerState = null;
				return;
			}

			const platform = process.platform;
			switch ( platform ) {
				case 'darwin': {
					// Add the original handler back to Launch Services
					const defaultsCommand = `defaults write com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers -array-add '{LSHandlerURLScheme = "${ PROTOCOL_PREFIX }"; LSHandlerRoleAll = "${ originalHandlerState.bundleId }";}'`;
					await executeCommand( defaultsCommand );

					// Re-register the original app
					await executeCommand( `${ LSREGISTER_PATH } -f "${ originalHandlerState.appPath }"` );
					break;
				}
				case 'win32':
					// Restore Windows registry entry
					await executeCommand(
						`reg add "HKEY_CURRENT_USER\\Software\\Classes\\${ PROTOCOL_PREFIX }\\shell\\open\\command" /ve /t REG_SZ /d "${ originalHandlerState.appPath } \\"%1\\"" /f`
					);
					break;
				default:
					// For Linux, the original app should still be registered via .desktop file
					// No additional action needed as we only remove our own .desktop file
					break;
			}

			originalHandlerState = null;
		} catch {
			originalHandlerState = null;
		}
	}
}

/**
 * Get the CLI executable command for protocol handling
 */
function getCLICommand(): string {
	const nodePath = process.argv[ 0 ];
	const scriptPath = process.argv[ 1 ];

	// Check if we're running via a global installation (npm, yarn, etc.)
	if (
		scriptPath.includes( '/bin/studio' ) ||
		scriptPath.includes( '.npm' ) ||
		path.basename( scriptPath ) === 'studio'
	) {
		// Global installation - use the CLI directly
		return `"${ scriptPath }" auth callback`;
	}

	// Check if we're running the built version
	if ( scriptPath.includes( 'dist/cli/main.js' ) ) {
		return `"${ nodePath }" "${ scriptPath }" auth callback`;
	}

	// Development mode - try to find the built version
	if ( scriptPath.includes( 'cli/index.ts' ) || scriptPath.includes( 'tsx' ) ) {
		const bundledPath = path.resolve( __dirname, '../../dist/cli/main.js' );
		if ( fs.existsSync( bundledPath ) ) {
			return `"${ nodePath }" "${ bundledPath }" auth callback`;
		}
	}

	// Fallback to current setup
	return `"${ nodePath }" "${ scriptPath }" auth callback`;
}

/**
 * Execute shell command with promise and return output
 */
function executeCommand( command: string ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( command, [], { shell: true } );
		let stdout = '';
		let stderr = '';

		child.stdout?.on( 'data', ( data ) => {
			stdout += data.toString();
		} );

		child.stderr?.on( 'data', ( data ) => {
			stderr += data.toString();
		} );

		child.on( 'exit', ( code ) => {
			if ( code === 0 ) {
				resolve( stdout.trim() );
			} else {
				reject(
					new Error( `Command failed with exit code ${ code }: ${ command }. stderr: ${ stderr }` )
				);
			}
		} );

		child.on( 'error', ( error ) => {
			reject( new Error( `Command failed: ${ command } - ${ error.message }` ) );
		} );
	} );
}

/**
 * Get default app for protocol on macOS using AppleScript
 */
async function getDefaultAppMacOS( protocol: string ): Promise< string | null > {
	try {
		const appleScript = `
use AppleScript version "2.4"
use framework "Foundation"
use framework "AppKit"

set theWorkspace to current application's NSWorkspace's sharedWorkspace()
set defaultAppURL to theWorkspace's URLForApplicationToOpenURL:(current application's |NSURL|'s URLWithString:"${ protocol }://test")
if defaultAppURL = missing value then
    return "pr-result=false"
else
    return (the POSIX path of (defaultAppURL as «class furl»)) as text
end if`;

		const result = await executeCommand(
			`osascript -e '${ appleScript.replace( /'/g, "'\"'\"'" ) }'`
		);
		return result.trim() === 'pr-result=false' ? null : result.trim();
	} catch {
		return null;
	}
}

async function registerProtocolMacOS(): Promise< void > {
	const cliCommand = getCLICommand();
	const appName = 'StudioCLIAuth';

	const appDir = path.join(
		os.homedir(),
		'Library',
		'Application Support',
		'Studio',
		'ProtocolHandler'
	);
	const appPath = path.join( appDir, `${ appName }.app` );

	protocolRegistrationPath = appPath;

	try {
		if ( fs.existsSync( appPath ) ) {
			await fs.promises.rm( appPath, { recursive: true, force: true } );
		}

		await fs.promises.mkdir( appDir, { recursive: true } );

		const escapedCliCommand = cliCommand.replace( /"/g, '\\"' );

		const appleScript = `on open location this_URL
    set command to "${ escapedCliCommand } '" & this_URL & "'"
    try
        do shell script "export PATH='${ process.env.PATH }'; " & command
    on error errMsg number errNum
        display dialog "CLI Auth Error: " & errMsg & return & "Command: " & command buttons {"OK"} default button 1
    end try
end open location`;

		const applescriptPath = path.join( appDir, `url-${ PROTOCOL_PREFIX }.applescript` );
		await fs.promises.writeFile( applescriptPath, appleScript );

		await executeCommand( `osacompile -o "${ appPath }" "${ applescriptPath }"` );
		await fs.promises.unlink( applescriptPath );

		const plistPath = path.join( appPath, 'Contents', 'Info.plist' );
		const plistContent = fs.readFileSync( plistPath, 'utf-8' );
		const plistObj = plist.parse( plistContent );

		// @ts-expect-error plist types are not complete.
		plistObj.CFBundleIdentifier = `${ BUNDLE_ID_PREFIX }.${ PROTOCOL_PREFIX }`;
		// @ts-expect-error plist types are not complete.
		plistObj.CFBundleURLTypes = [
			{
				CFBundleURLName: `URL : ${ PROTOCOL_PREFIX }`,
				CFBundleURLSchemes: [ PROTOCOL_PREFIX ],
			},
		];

		fs.writeFileSync( plistPath, plist.build( plistObj ) );

		await executeCommand( `open -g -W "${ appPath }"` );

		const bundleId = `${ BUNDLE_ID_PREFIX }.${ PROTOCOL_PREFIX }`;
		const defaultsCommand = `defaults write com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers -array-add '{LSHandlerURLScheme = "${ PROTOCOL_PREFIX }"; LSHandlerRoleAll = "${ bundleId }";}'`;

		await executeCommand( defaultsCommand );

		const lsregisterCommand = `${ LSREGISTER_PATH } -kill -r -domain local -domain system -domain user`;
		await executeCommand( lsregisterCommand );

		const reregisterCommand = `${ LSREGISTER_PATH } -f "${ appPath }"`;
		await executeCommand( reregisterCommand );
	} catch ( error ) {
		if ( protocolRegistrationPath && fs.existsSync( protocolRegistrationPath ) ) {
			await fs.promises.rm( protocolRegistrationPath, { recursive: true, force: true } );
			protocolRegistrationPath = null;
		}
		throw error;
	}
}

async function getDefaultAppWindows( protocol: string ): Promise< string | null > {
	try {
		const result = await executeCommand(
			`reg query "HKEY_CURRENT_USER\\Software\\Classes\\${ protocol }\\shell\\open\\command" /ve`
		);
		return result.includes( 'REG_SZ' ) ? result : null;
	} catch {
		return null;
	}
}

async function registerProtocolWindows(): Promise< void > {
	const cliCommand = getCLICommand();

	await executeCommand(
		`reg add "HKEY_CURRENT_USER\\Software\\Classes\\${ PROTOCOL_PREFIX }" /ve /t REG_SZ /d "URL:WordPress Studio Protocol" /f`
	);
	await executeCommand(
		`reg add "HKEY_CURRENT_USER\\Software\\Classes\\${ PROTOCOL_PREFIX }" /v "URL Protocol" /t REG_SZ /d "" /f`
	);
	await executeCommand(
		`reg add "HKEY_CURRENT_USER\\Software\\Classes\\${ PROTOCOL_PREFIX }\\shell\\open\\command" /ve /t REG_SZ /d "${ cliCommand } \\"%1\\"" /f`
	);
}

async function getDefaultAppLinux( protocol: string ): Promise< string | null > {
	try {
		const result = await executeCommand(
			`xdg-mime query default "x-scheme-handler/${ protocol }"`
		);
		return result.trim() || null;
	} catch {
		return null;
	}
}

async function registerProtocolLinux(): Promise< void > {
	const cliCommand = getCLICommand();
	const homeDir = os.homedir();
	const applicationsDir = path.join( homeDir, '.local', 'share', 'applications' );

	await fs.promises.mkdir( applicationsDir, { recursive: true } );

	const desktopContent = `[Desktop Entry]
Name=Studio CLI Auth Handler
Type=Application
Exec=${ cliCommand } %u
MimeType=x-scheme-handler/${ PROTOCOL_PREFIX }
NoDisplay=true
`;

	const desktopFileName = `studio-cli-auth-${ Date.now() }.desktop`;
	const desktopFile = path.join( applicationsDir, desktopFileName );
	await fs.promises.writeFile( desktopFile, desktopContent );

	protocolRegistrationPath = desktopFile;

	await executeCommand(
		`xdg-mime default "${ desktopFileName }" "x-scheme-handler/${ PROTOCOL_PREFIX }"`
	);
	await executeCommand( 'update-desktop-database ~/.local/share/applications' );
}
