import fs from 'fs';
import os from 'os';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { readFile, writeFile } from 'atomically';
import { LOCKFILE_NAME, LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from 'common/constants';
import { arePathsEqual } from 'common/lib/fs-utils';
import { lockFileAsync, unlockFileAsync } from 'common/lib/lockfile';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { snapshotSchema } from 'common/types/snapshot';
import { StatsMetric } from 'common/types/stats';
import { z } from 'zod';
import { validateAccessToken } from 'cli/lib/api';
import { LoggerError } from 'cli/logger';

const siteSchema = z
	.object( {
		id: z.string(),
		path: z.string(),
		name: z.string(),
		phpVersion: z.string(),
		customDomain: z.string().optional(),
		port: z.number(),
		enableHttps: z.boolean().optional(),
		adminPassword: z.string().optional(),
		isWpAutoUpdating: z.boolean().optional(),
		running: z.boolean().optional(),
		url: z.string().optional(),
		latestCliPid: z.number().optional(),
	} )
	.passthrough();

const betaFeaturesSchema = z
	.object( {
		studioSitesCli: z.boolean().optional(),
	} )
	.passthrough();

const userDataSchema = z
	.object( {
		sites: z.array( siteSchema ).default( () => [] ),
		snapshots: z.array( snapshotSchema ).default( () => [] ),
		locale: z.string().optional(),
		authToken: z
			.object( {
				accessToken: z.string().min( 1, __( 'Access token cannot be empty' ) ),
				expiresIn: z.number(), // Seconds
				expirationTime: z.number(), // Milliseconds since the Unix epoch
				id: z.number().optional(),
				email: z.string(),
				displayName: z.string().default( '' ),
			} )
			.passthrough()
			.optional(),
		lastBumpStats: z
			.record( z.string(), z.record( z.nativeEnum( StatsMetric ), z.number() ) )
			.optional(),
		betaFeatures: betaFeaturesSchema.optional(),
	} )
	.passthrough();

type UserData = z.infer< typeof userDataSchema >;
export type SiteData = z.infer< typeof siteSchema >;
type ValidatedAuthToken = Required< NonNullable< UserData[ 'authToken' ] > >;

export function getAppdataDirectory(): string {
	if ( process.platform === 'win32' ) {
		if ( ! process.env.APPDATA ) {
			throw new LoggerError( __( 'Studio config file path not found.' ) );
		}

		return path.join( process.env.APPDATA, 'Studio' );
	}

	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio' );
}

export function getAppdataPath(): string {
	const appdataDir = getAppdataDirectory();
	return path.join( appdataDir, 'appdata-v1.json' );
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

export async function getAuthToken(): Promise< ValidatedAuthToken > {
	try {
		const { authToken } = await readAppdata();

		if ( ! authToken?.accessToken || ! authToken?.id || Date.now() >= authToken?.expirationTime ) {
			throw new Error( 'Authentication required' );
		}

		await validateAccessToken( authToken.accessToken );

		return authToken as ValidatedAuthToken;
	} catch ( error ) {
		const authUrl = getAuthenticationUrl( 'en' );

		throw new LoggerError(
			sprintf(
				// translators: %s is a URL to log in to WordPress.com
				__( 'Authentication required. Please log in to WordPress.com first:\n%s' ),
				authUrl
			)
		);
	}
}

export async function getSiteByFolder( siteFolder: string ): Promise< SiteData > {
	const userData = await readAppdata();
	const site = userData.sites.find( ( site ) => arePathsEqual( site.path, siteFolder ) );

	if ( ! site ) {
		throw new LoggerError(
			__(
				'The specified folder is not added to Studio. Please use `studio site create` to add it first.'
			)
		);
	}

	return site;
}

export function getSiteUrl( site: SiteData ): string {
	if ( site.url ) {
		return site.url;
	}

	if ( site.customDomain ) {
		const protocol = site.enableHttps ? 'https' : 'http';
		return `${ protocol }://${ site.customDomain }`;
	}

	return `http://localhost:${ site.port }`;
}

export async function updateSiteLatestCliPid( siteId: string, pid: number ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await readAppdata();
		const site = userData.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		site.latestCliPid = pid;
		await saveAppdata( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function clearSiteLatestCliPid( siteId: string ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await readAppdata();
		const site = userData.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		delete site.latestCliPid;
		await saveAppdata( userData );
	} finally {
		await unlockAppdata();
	}
}
