import path from 'path';
import Registry from 'winreg'; // don't update winreg to 1.2.5 - https://github.com/fresc81/node-winreg/issues/65
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import { mkdir, writeFile } from 'fs/promises'

//Example of process.execPath - C:\Users\<USERNAME>\AppData\Local\studio\app-1.3.9-beta1\Studio.exe
const localAppBinPath = path.resolve(process.execPath, '../../bin');
const PATH_KEY = 'Path';

const currentUserRegistry = new Registry({
	hive: Registry.HKCU,
	key: '\\Environment',
});

const getPathFromRegistry = (): Promise<string> => {
	return new Promise((resolve, reject) => {
		currentUserRegistry.get( PATH_KEY, (error, item) => {
			if ( error ) {
				return reject( error );
			}

			resolve( item?.value || '' );
		});
	});
};

const setPathToRegistry = ( updatedPath: string ): Promise<void> => {
	return new Promise((resolve, reject) => {
		currentUserRegistry.set( PATH_KEY, Registry.REG_EXPAND_SZ, updatedPath, ( error ) => {
			if ( error ) {
				return reject( error );
			}

			resolve();
		});
	});
};

const isStudioCliInPath = ( pathValue: string ): boolean => {
	return pathValue
		.split( ';' )
		.map( ( item ) => item.trim().toLowerCase() )
		.includes( localAppBinPath.toLowerCase() );
};

const installPath = async () => {
	try {
		const currentPath = await getPathFromRegistry();

	if ( isStudioCliInPath( currentPath ) ) {
		return;
	}

	const updatedPath = currentPath
		.split(';')
		.map( p => p.trim() )
		.filter(Boolean)
		.concat( localAppBinPath )
		.join(';');

		await setPathToRegistry( updatedPath );
	} catch (error) {
		Sentry.captureException( error );
		console.error( 'Failed to install CLI: PATH to Registry', error );
	}
};

/**
 * Our app is installed in a versioned directory, so the
 * full path changes with every update. This makes it unreliable to add the
 * executable directly to the system PATH — we'd also need to handle cleaning up
 * outdated entries manually.
 *
 * To solve this, we generate a fixed entry point (a proxy script) in a
 * stable location within AppData, outside the versioned folder. This script
 * simply forwards execution to the current version’s actual CLI entry point.
 * On update, we just rewrite the proxy to point to the new version.
 */
const installProxyBatFile = async () => {
	try {
		await mkdir( localAppBinPath, { recursive: true } );

		const appFolder = path.resolve( process.execPath, '..' );
		const relativePath = 'resources/bin/studio-cli.bat';
		const versionedPath = path.relative( localAppBinPath, path.join( appFolder, relativePath ) );

		const content = `@echo off\n"%~dp0\\${ versionedPath }" %*`;

		await writeFile(
			path.join( localAppBinPath, 'studio.bat' ),
			content,
		);
	} catch (error) {
		Sentry.captureException( error );
		console.error( 'Failed to install CLI: Proxy Bat file', error );
	}
};

export const installCLIOnWindows = async () =>  {
	if ( process.platform !== 'win32' ) {
		return;
	}

	await installPath();
	await installProxyBatFile();
};
