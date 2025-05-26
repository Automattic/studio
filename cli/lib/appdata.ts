import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { readFile, writeFile } from 'atomically';
import { arePathsEqual } from 'common/lib/fs-utils';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { snapshotSchema } from 'common/types/snapshot';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { z } from 'zod';
import { validateAccessToken } from 'cli/lib/api';
import { LoggerError } from 'cli/logger';

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
			.record(
				z.union( [ z.nativeEnum( StatsGroup ), z.literal( 'local-environment-launch-uniques' ) ] ),
				z.record( z.nativeEnum( StatsMetric ), z.number() )
			)
			.optional(),
	} )
	.passthrough();

type UserData = z.infer< typeof userDataSchema >;

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
	const appDataPath = getAppdataPath();

	try {
		if ( ! userData.version ) {
			userData.version = 1;
		}

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
		const locale = await getUserLocaleWithFallback();
		const authUrl = getAuthenticationUrl( locale );

		throw new LoggerError(
			sprintf(
				// translators: %s is a URL to log in to WordPress.com
				__( 'Authentication required. Please log in to WordPress.com first:\n%s' ),
				authUrl
			)
		);
	}
}

export async function getSiteByFolder(
	siteFolder: string
): Promise< z.infer< typeof siteSchema > > {
	const userData = await readAppdata();
	const site = [ ...userData.sites, ...userData.newSites ].find( ( site ) =>
		arePathsEqual( site.path, siteFolder )
	);

	if ( ! site ) {
		throw new LoggerError( __( 'The specified folder is not added to Studio.' ) );
	}

	return site;
}

export function getNewSitePartial( siteFolder: string ): z.infer< typeof siteSchema > {
	const newSite = {
		id: crypto.randomUUID(),
		path: siteFolder,
		name: path.basename( siteFolder ),
	};

	return newSite;
}

export async function getOrCreateSiteByFolder(
	siteFolder: string
): Promise< z.infer< typeof siteSchema > > {
	let site;
	try {
		site = await getSiteByFolder( siteFolder );
	} catch ( error ) {
		if ( ! ( error instanceof LoggerError ) ) {
			throw error;
		}
		const userData = await readAppdata();
		site = getNewSitePartial( siteFolder );
		userData.newSites.push( site );
		await saveAppdata( userData );
	}
	return site;
}
