import { app } from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'node:fs';
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

function getPathFromRegistry(): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		currentUserRegistry.get( PATH_KEY, ( error, item ) => {
			if ( error ) {
				return reject( error );
			}

			resolve( item?.value || '' );
		} );
	} );
}

function setPathInRegistry( updatedPath: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		currentUserRegistry.set( PATH_KEY, Registry.REG_EXPAND_SZ, updatedPath, ( error ) => {
			if ( error ) {
				return reject( error );
			}

			resolve();
		} );
	} );
}

function isStudioCliInPath( pathValue: string, studioCliDir = unversionedBinDirPath ): boolean {
	return pathValue
		.split( ';' )
		.map( ( item ) => item.trim().toLowerCase() )
		.includes( studioCliDir.toLowerCase() );
}

async function installPath() {
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
		console.error( 'Failed to install CLI', error );
	}
}

/**
 * Creates a proxy batch file in a stable location to handle CLI execution.
 *
 * Since our app is installed in a versioned directory, the full path changes with each update.
 * Instead of adding the versioned executable directly to PATH, we create a fixed proxy script
 * in the AppData directory that forwards execution to the current version's CLI entry point.
 */
async function installProxyBatFile() {
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
}

export async function isCliInstalled() {
	try {
		const currentPath = await getPathFromRegistry();

		// Return true if we are running the development version of the app and the production CLI is installed
		if ( process.env.NODE_ENV !== 'production' && process.env.LOCALAPPDATA ) {
			const prodStudioCliDir = path.join( process.env.LOCALAPPDATA, 'studio', 'bin' );
			if ( isStudioCliInPath( currentPath, prodStudioCliDir ) ) {
				return true;
			}
		}

		if ( ! isStudioCliInPath( currentPath ) ) {
			return false;
		}

		if ( ! existsSync( unversionedBinDirPath ) ) {
			return false;
		}

		return true;
	} catch ( error ) {
		console.error( 'Failed to check installation status of CLI', error );
		return false;
	}
}

export async function uninstallCli() {
	try {
		const currentPath = await getPathFromRegistry();
		const newPath = currentPath
			.split( ';' )
			.filter( ( item ) => item.trim().toLowerCase() !== unversionedBinDirPath.toLowerCase() )
			.join( ';' );

		await setPathInRegistry( newPath );
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( 'Failed to uninstall CLI', error );
	}
}

export async function installCli() {
	if ( process.platform !== 'win32' ) {
		return;
	}

	await installPath();
	await installProxyBatFile();
}
