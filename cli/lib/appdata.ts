import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { readFile, writeFile } from 'atomically';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { snapshotSchema } from 'common/types/snapshot';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import { z } from 'zod';
import { validateAccessToken } from 'cli/lib/api';
import { lock, unlock } from 'cli/lib/utils';
import { LoggerError } from 'cli/logger';

const LOCKFILE_PATH = path.join( getAppdataDirectory(), 'appdata-v1.lock' );

export function withAppdataWrite< Args extends unknown[], R = unknown >(
	fn: ( userData: UserData, ...args: Args ) => AsyncGenerator< UserData, R, unknown >
) {
	return async ( ...args: Args ): Promise< R > => {
		await lock( LOCKFILE_PATH, { wait: 1000, stale: 1000 } );
		try {
			const data = await readAppdata();
			const generator = fn( data, ...args );

			// eslint-disable-next-line no-constant-condition
			while ( true ) {
				const { value, done } = await generator.next();
				if ( done ) {
					return value;
				}
				await saveAppdata( value );
			}
		} finally {
			await unlock( LOCKFILE_PATH );
		}
	};
}

const siteSchema = z
	.object( {
		id: z.string(),
		path: z.string(),
		name: z.string(),
	} )
	.passthrough();

const userDataSchema = z
	.object( {
		newSites: z.array( siteSchema ).default( () => [] ),
		sites: z.array( siteSchema ).default( () => [] ),
		snapshots: z.array( snapshotSchema ).default( () => [] ),
		locale: z.string().optional(),
		authToken: z
			.object( {
				accessToken: z.string().min( 1, __( 'Access token cannot be empty' ) ),
				id: z.number(),
			} )
			.passthrough()
			.optional(),
		lastBumpStats: z
			.record( z.nativeEnum( StatsGroup ), z.record( z.nativeEnum( StatsMetric ), z.number() ) )
			.optional(),
	} )
	.passthrough();

type UserData = z.infer< typeof userDataSchema >;
type SiteData = z.infer< typeof siteSchema >;

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

async function saveAppdata( userData: UserData ): Promise< void > {
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

export async function getAuthToken(): Promise< NonNullable< UserData[ 'authToken' ] > > {
	try {
		const { authToken } = await readAppdata();

		if ( ! authToken?.accessToken ) {
			throw new Error( 'Authentication required' );
		}

		await validateAccessToken( authToken.accessToken );

		return authToken;
	} catch ( error ) {
		const authUrl = getAuthenticationUrl();

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
	const site = [ ...userData.sites, ...userData.newSites ].find(
		( site ) => site.path === siteFolder
	);

	if ( ! site ) {
		throw new LoggerError( __( 'The specified folder is not added to Studio.' ) );
	}

	return site;
}

export function getNewSitePartial( siteFolder: string ): SiteData {
	const newSite = {
		id: crypto.randomUUID(),
		path: siteFolder,
		name: path.basename( siteFolder ),
	};

	return newSite;
}

export const getOrCreateSiteByFolder = withAppdataWrite( async function* (
	userData,
	siteFolder: string
) {
	let site;
	try {
		site = await getSiteByFolder( siteFolder );
	} catch ( error ) {
		if ( ! ( error instanceof LoggerError ) ) {
			throw error;
		}
		site = getNewSitePartial( siteFolder );
		userData.newSites.push( site );
		yield userData;
	}
	return site;
} );
