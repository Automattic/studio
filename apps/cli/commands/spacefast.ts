import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	createSpacefastSpace,
	getSpacefastSpace,
	listSpacefastSpaces,
	listSpacefastTeams,
	publishDirectoryToSpacefast,
	startSpacefastDeviceLogin,
	waitForSpacefastDeviceLogin,
} from '@studio/common/lib/spacefast/api';
import {
	clearSpacefastAuth,
	getSpacefastConnection,
	readSpacefastAuth,
	saveSpacefastAuth,
	saveSpacefastConnection,
} from '@studio/common/lib/spacefast/config';
import { __, sprintf } from '@wordpress/i18n';
import { runCommand as exportStaticSite } from 'cli/commands/export-static';
import { openBrowser } from 'cli/lib/browser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { Logger, LoggerError } from 'cli/logger';
import type { SpacefastConnection, SpacefastPublishTarget } from '@studio/common/types/spacefast';
import type { publishBuilder } from 'cli/commands/spacefast.command';
import type { SiteData } from 'cli/lib/cli-config/core';
import type { CommandArgs } from 'cli/types';

const logger = new Logger< string >();

// Files served from the root of a version. WordPress never serves them, so the static export
// can't crawl them; a site that needs redirects, headers, a robots.txt or an llms.txt keeps them
// at its root and they are published as they are.
const SPACEFAST_SITE_FILES = [ '_redirects', '_headers', 'robots.txt', 'llms.txt' ];

export async function copySpacefastSiteFiles(
	sitePath: string,
	outputDir: string
): Promise< void > {
	for ( const name of SPACEFAST_SITE_FILES ) {
		try {
			await fs.promises.copyFile( path.join( sitePath, name ), path.join( outputDir, name ) );
		} catch ( error ) {
			if ( ( error as NodeJS.ErrnoException ).code !== 'ENOENT' ) {
				throw error;
			}
		}
	}
}

async function login(): Promise< void > {
	const deviceLogin = await startSpacefastDeviceLogin();
	console.log(
		sprintf(
			__( 'Approve the login with code %1$s at %2$s' ),
			deviceLogin.userCode,
			deviceLogin.verificationUrl
		)
	);
	await openBrowser( deviceLogin.verificationUrl ).catch( () => undefined );
	logger.reportStart( 'login', __( 'Waiting for approval…' ) );
	await saveSpacefastAuth( await waitForSpacefastDeviceLogin( deviceLogin ) );
	logger.reportSuccess( __( 'Logged in to Spacefast' ) );
}

async function publish(
	sitePath: string,
	{ space, newSpace, team }: { space?: string; newSpace?: string; team?: string }
): Promise< void > {
	const site = await getSiteByFolder( sitePath );
	const report = ( message: string ) => {
		logger.reportStart( 'publish', message );
		void reportSyncActivity( site.id, { kind: 'pending', direction: 'spacefast', message } );
	};

	try {
		const auth = await readSpacefastAuth();
		if ( ! auth ) {
			throw new LoggerError( __( 'Log in to Spacefast first with `studio spacefast login`.' ) );
		}
		const target = await resolveTarget( auth.apiKey, site, { space, newSpace, team } );
		const destination =
			'spaceId' in target
				? await getSpacefastSpace( auth.apiKey, target.spaceId )
				: await createSpacefastSpace( auth.apiKey, target );

		const dir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-spacefast-' ) );
		try {
			const outputDir = path.join( dir, 'site' );
			report( __( 'Generating static files…' ) );
			await exportStaticSite( sitePath, outputDir, undefined, false );
			await copySpacefastSiteFiles( sitePath, outputDir );
			await publishDirectoryToSpacefast(
				auth.apiKey,
				destination.id,
				outputDir,
				( { uploaded, total } ) =>
					report(
						uploaded < total
							? sprintf( __( 'Uploading %1$d of %2$d files…' ), uploaded, total )
							: __( 'Publishing the new version…' )
					)
			);
		} finally {
			await fs.promises.rm( dir, { recursive: true, force: true } ).catch( () => undefined );
		}

		const connection: SpacefastConnection = {
			spaceId: destination.id,
			title: destination.title,
			liveUrl: destination.liveUrl,
			lastPublishedAt: Date.now(),
		};
		await saveSpacefastConnection( site.id, connection );
		await reportSyncActivity( site.id, { kind: 'success', direction: 'spacefast' } );
		logger.reportSuccess( sprintf( __( 'Published to %s' ), connection.liveUrl ) );
		logger.reportResult( connection );
	} catch ( error ) {
		await reportSyncActivity( site.id, {
			kind: 'error',
			direction: 'spacefast',
			message: error instanceof Error ? error.message : String( error ),
		} );
		throw error;
	}
}

async function resolveTarget(
	apiKey: string,
	site: SiteData,
	{ space, newSpace, team }: { space?: string; newSpace?: string; team?: string }
): Promise< SpacefastPublishTarget > {
	if ( newSpace !== undefined ) {
		const teamId = team ?? ( await listSpacefastTeams( apiKey ) )[ 0 ]?.id;
		if ( ! teamId ) {
			throw new LoggerError( __( 'Your Spacefast account has no team to create a Space in.' ) );
		}
		return { teamId, title: newSpace || site.name };
	}
	if ( space ) {
		const match = ( await listSpacefastSpaces( apiKey ) ).find(
			( { id, slug } ) => id === space || slug === space
		);
		if ( ! match ) {
			throw new LoggerError( sprintf( __( 'No Spacefast Space matches %s.' ), space ) );
		}
		return { spaceId: match.id };
	}
	const connection = await getSpacefastConnection( site.id );
	if ( ! connection ) {
		throw new LoggerError(
			__( 'This site has not been published yet. Pass --space or --new-space.' )
		);
	}
	return { spaceId: connection.spaceId };
}

export function loginHandler() {
	return run( login );
}

export function logoutHandler() {
	return run( async () => {
		await clearSpacefastAuth();
		logger.reportSuccess( __( 'Logged out of Spacefast' ) );
	} );
}

export function publishHandler( argv: CommandArgs< typeof publishBuilder > ) {
	return run( () =>
		publish( argv.path, { space: argv.space, newSpace: argv.newSpace, team: argv.team } )
	);
}

async function run( action: () => Promise< void > ): Promise< void > {
	try {
		await action();
	} catch ( error ) {
		logger.reportError(
			error instanceof LoggerError
				? error
				: new LoggerError( __( 'Spacefast command failed' ), error )
		);
	}
}
