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
 * Creates a proxy batch file in a stable location to handle CLI execution.
 *
 * Since our app is installed in a versioned directory, the full path changes with each update.
 * Instead of adding the versioned executable directly to PATH, we create a fixed proxy script
 * in the AppData directory that forwards execution to the current version's CLI entry point.
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
	if ( process.platform !== 'win32' || process.env.NODE_ENV === 'development' ) {
		return;
	}

	await installPath();
	await installProxyBatFile();
};
