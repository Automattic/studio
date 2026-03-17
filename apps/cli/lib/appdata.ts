import fs from 'fs';
import os from 'os';
import path from 'path';
import { LOCKFILE_NAME, LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { arePathsEqual, isWordPressDirectory } from '@studio/common/lib/fs-utils';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import { siteDetailsSchema } from '@studio/common/lib/site-events';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { __, sprintf } from '@wordpress/i18n';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { validateAccessToken } from 'cli/lib/api';
import { StatsMetric } from 'cli/lib/types/bump-stats';
import { LoggerError } from 'cli/logger';
import type { AiProviderId } from 'cli/ai/providers';

const siteSchema = siteDetailsSchema
	.extend( {
		running: z.boolean().optional(),
		url: z.string().optional(),
		latestCliPid: z.number().optional(),
		enableXdebug: z.boolean().optional(),
	} )
	.loose();

const betaFeaturesSchema = z.object( {} ).loose();
const aiProviderSchema = z.enum( [ 'wpcom', 'anthropic-claude', 'anthropic-api-key' ] );

const userDataSchema = z
	.object( {
		sites: z.array( siteSchema ).default( () => [] ),
		snapshots: z.array( snapshotSchema ).default( () => [] ),
		locale: z.string().optional(),
		aiProvider: aiProviderSchema.optional(),
		authToken: z
			.object( {
				accessToken: z.string().min( 1, __( 'Access token cannot be empty' ) ),
				expiresIn: z.number(), // Seconds
				expirationTime: z.number(), // Milliseconds since the Unix epoch
				id: z.number().optional(),
				email: z.string(),
				displayName: z.string().default( '' ),
			} )
			.loose()
			.optional(),
		lastBumpStats: z.record( z.string(), z.record( z.string(), z.number() ) ).optional(),
		betaFeatures: betaFeaturesSchema.optional(),
	} )
	.loose();

type UserData = z.infer< typeof userDataSchema > & {
	anthropicApiKey?: string;
};
export type SiteData = z.infer< typeof siteSchema >;
export type ValidatedAuthToken = Required< NonNullable< UserData[ 'authToken' ] > >;

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
		if ( isWordPressDirectory( siteFolder ) ) {
			throw new LoggerError(
				__( 'The specified directory is not added to Studio. Use `studio site create` to add it.' )
			);
		}

		throw new LoggerError( __( 'The specified directory is not added to Studio.' ) );
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

export async function updateSiteAutoStart( siteId: string, autoStart: boolean ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await readAppdata();
		const site = userData.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		site.autoStart = autoStart;
		await saveAppdata( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function getAnthropicApiKey(): Promise< string | undefined > {
	const userData = await readAppdata();
	return userData.anthropicApiKey;
}

export async function getAiProvider(): Promise< AiProviderId | undefined > {
	const userData = await readAppdata();
	return userData.aiProvider;
}

export async function saveAnthropicApiKey( apiKey: string ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await readAppdata();
		userData.anthropicApiKey = apiKey;
		await saveAppdata( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function saveAiProvider( provider: AiProviderId ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await readAppdata();
		userData.aiProvider = provider;
		await saveAppdata( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function removeSiteFromAppdata( siteId: string ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await readAppdata();
		userData.sites = userData.sites.filter( ( s ) => s.id !== siteId );
		await saveAppdata( userData );
	} finally {
		await unlockAppdata();
	}
}
