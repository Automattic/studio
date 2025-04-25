import fs from 'fs';
import os from 'os';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { snapshotSchema } from 'common/types/snapshot';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import { z } from 'zod';
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
		sites: z.array( siteSchema ).optional(),
		snapshots: z.array( snapshotSchema ).optional(),
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

export function getAppdataPath(): string {
	if ( process.platform === 'win32' ) {
		if ( ! process.env.APPDATA ) {
			throw new LoggerError( __( 'Appdata path not found.' ) );
		}

		return path.join( process.env.APPDATA, 'Studio', 'appdata-v1.json' );
	}

	const homeDir = os.homedir();
	return path.join( homeDir, 'Library', 'Application Support', 'Studio', 'appdata-v1.json' );
}

export async function readAppdata(): Promise< UserData > {
	const appDataPath = getAppdataPath();

	if ( ! fs.existsSync( appDataPath ) ) {
		throw new LoggerError( __( 'Appdata file not found. Please run the Studio app first.' ) );
	}

	try {
		const fileContent = fs.readFileSync( appDataPath, 'utf8' );
		const userData = JSON.parse( fileContent );
		const result = userDataSchema.parse( userData );

		return result;
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		if ( error instanceof z.ZodError ) {
			throw new LoggerError(
				__( 'Invalid appdata format. Please run the Studio app again.' ),
				error
			);
		}

		if ( error instanceof SyntaxError ) {
			throw new LoggerError(
				__( 'Appdata file is corrupted. Please run the Studio app again.' ),
				error
			);
		}

		throw new LoggerError(
			__( 'Failed to read appdata file. Please run the Studio app again.' ),
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

		fs.writeFileSync( appDataPath, fileContent, 'utf8' );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to save appdata file' ), error );
	}
}

export async function getAuthToken(): Promise< NonNullable< UserData[ 'authToken' ] > > {
	try {
		const { authToken } = await readAppdata();

		if ( ! authToken?.accessToken ) {
			throw new Error( 'Authentication required' );
		}

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

export async function getSiteByFolder(
	siteFolder: string
): Promise< z.infer< typeof siteSchema > > {
	const userData = await readAppdata();
	const sites = userData.sites ?? [];
	const site = sites.find( ( site ) => site.path === siteFolder );

	if ( ! site ) {
		throw new LoggerError( __( 'The specified folder is not added to Studio.' ) );
	}

	return site;
}
