import { app } from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import Registry from 'winreg'; // don't update winreg to 1.2.5 - https://github.com/fresc81/node-winreg/issues/65

// `unversionedBinDirPath` resolves to C:\Users\<USERNAME>\AppData\Local\studio\bin
const unversionedBinDirPath = path.resolve( path.dirname( app.getPath( 'exe' ) ), '../bin' );
const PATH_KEY = 'Path';

const currentUserRegistry = new Registry( {
	hive: Registry.HKCU,
	key: '\\Environment',
} );

const getPathFromRegistry = (): Promise< string > => {
	return new Promise( ( resolve, reject ) => {
		currentUserRegistry.get( PATH_KEY, ( error, item ) => {
			if ( error ) {
				return reject( error );
			}

			resolve( item?.value || '' );
		} );
	} );
};

const setPathInRegistry = ( updatedPath: string ): Promise< void > => {
	return new Promise( ( resolve, reject ) => {
		currentUserRegistry.set( PATH_KEY, Registry.REG_EXPAND_SZ, updatedPath, ( error ) => {
			if ( error ) {
				return reject( error );
			}

			resolve();
		} );
	} );
};

const isStudioCliInPath = ( pathValue: string ): boolean => {
	return pathValue
		.split( ';' )
		.map( ( item ) => item.trim().toLowerCase() )
		.includes( unversionedBinDirPath.toLowerCase() );
};

const installPath = async () => {
	try {
		const currentPath = await getPathFromRegistry();

		if ( isStudioCliInPath( currentPath ) ) {
			return;
		}

		const updatedPath = currentPath
			.split( ';' )
			.map( ( p ) => p.trim() )
			.filter( Boolean )
			.concat( unversionedBinDirPath )
			.join( ';' );

		await setPathInRegistry( updatedPath );
	} catch ( error ) {
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
		await mkdir( unversionedBinDirPath, { recursive: true } );

		const versionedCliPath = path.join(
			path.dirname( app.getPath( 'exe' ) ),
			'resources/bin/studio-cli.bat'
		);
		const relativeVersionedCliPath = path.relative( unversionedBinDirPath, versionedCliPath );

		const content = `@echo off\n"%~dp0\\${ relativeVersionedCliPath }" %*`;

		await writeFile( path.join( unversionedBinDirPath, 'studio.bat' ), content );
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( 'Failed to install CLI: Proxy Bat file', error );
	}
};

export const installCLIOnWindows = async () => {
	if ( process.platform !== 'win32' ) {
		return;
	}

	await installPath();
	await installProxyBatFile();
};
