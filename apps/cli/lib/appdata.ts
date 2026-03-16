import fs from 'fs';
import os from 'os';
import path from 'path';
import { LOCKFILE_NAME, LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { StatsMetric } from '@studio/common/types/stats';
import { __ } from '@wordpress/i18n';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

const betaFeaturesSchema = z.object( {} ).loose();

const userDataSchema = z
	.object( {
		snapshots: z.array( snapshotSchema ).default( () => [] ),
		lastBumpStats: z
			.record( z.string(), z.partialRecord( z.enum( StatsMetric ), z.number() ) )
			.optional(),
		betaFeatures: betaFeaturesSchema.optional(),
	} )
	.loose();

type UserData = z.infer< typeof userDataSchema >;

export function getAppdataDirectory(): string {
	// Support E2E testing with custom appdata path
	// Must include 'Studio' subfolder to match Electron app's path structure
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		return path.join( process.env.E2E_APP_DATA_PATH, 'Studio' );
	}

	if ( process.platform === 'win32' ) {
		if ( ! process.env.APPDATA ) {
			throw new LoggerError( __( 'Studio config file path not found.' ) );
		}

		return path.join( process.env.APPDATA, 'Studio' );
	}

	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio' );
}

export function getAppdataPath(): string {
	if ( process.env.DEV_APP_DATA_PATH ) {
		return process.env.DEV_APP_DATA_PATH;
	}
	return path.join( getAppdataDirectory(), 'appdata-v1.json' );
}

export async function readAppdata(): Promise< UserData > {
	const appDataPath = getAppdataPath();

	if ( ! fs.existsSync( appDataPath ) ) {
		throw new LoggerError( __( 'Studio config file not found. Please run the Studio app first.' ) );
	}

	try {
		const fileContent = await readFile( appDataPath, { encoding: 'utf8' } );
		const userData = JSON.parse( fileContent );
		return userDataSchema.parse( userData );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		if ( error instanceof z.ZodError ) {
			throw new LoggerError(
				__( 'Invalid Studio config file format. Please run the Studio app again.' ),
				error
			);
		}

		if ( error instanceof SyntaxError ) {
			throw new LoggerError(
				__( 'Studio config file is corrupted. Please run the Studio app again.' ),
				error
			);
		}

		throw new LoggerError(
			__( 'Failed to read Studio config file. Please run the Studio app again.' ),
			error
		);
	}
}

export async function saveAppdata( userData: UserData ): Promise< void > {
	try {
		if ( ! userData.version ) {
			userData.version = 1;
		}

		const appDataPath = getAppdataPath();
		const fileContent = JSON.stringify( userData, null, 2 ) + '\n';

		await writeFile( appDataPath, fileContent, { encoding: 'utf8' } );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to save Studio config file' ), error );
	}
}

const LOCKFILE_PATH = path.join( getAppdataDirectory(), LOCKFILE_NAME );

export async function lockAppdata(): Promise< void > {
	await lockFileAsync( LOCKFILE_PATH, { wait: LOCKFILE_WAIT_TIME, stale: LOCKFILE_STALE_TIME } );
}

export async function unlockAppdata(): Promise< void > {
	await unlockFileAsync( LOCKFILE_PATH );
}
