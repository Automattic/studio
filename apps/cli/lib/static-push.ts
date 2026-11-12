import fs from 'fs';
import os from 'os';
import path from 'path';
import { connectProvider } from '@studio/common/lib/ai-settings';
import { formatProgressLabel } from '@studio/common/lib/progress-label';
import { readProviderConfig } from '@studio/common/lib/provider-config';
import { getRemoteSites, rememberRemoteSite } from '@studio/common/lib/remote-sites';
import {
	getProviderDescriptor,
	type PushFile,
	type Space,
	SpacefastConfig,
} from '@studio/providers';
import { getProvider } from '@studio/providers/services';
import { __, sprintf } from '@wordpress/i18n';
import { runCommand as exportStaticSite } from 'cli/commands/export-static';
import { openBrowser } from 'cli/lib/browser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { confirm, select } from 'cli/lib/prompts';
import { onCancel, reportSyncActivity } from 'cli/lib/sync-activity';
import { toLoggerError } from 'cli/lib/sync-api';
import { Logger, LoggerError } from 'cli/logger';
import type { SyncActivity } from '@studio/common/lib/sync/activity';

const spacefast = getProvider( 'spacefast' );
const NEW_SPACE = Symbol( 'new-space' );

// Files served from the root of the site. WordPress never serves them, so the static export
// can't crawl them; a site that needs redirects, headers, a robots.txt or an llms.txt keeps them
// at its root and they are published as they are.
const ROOT_FILES = [ '_redirects', '_headers', 'robots.txt', 'llms.txt' ];

/**
 * Publishes a static export of the site to a Spacefast Space: `identifier` (its id, slug or
 * URL), the Space the site last published to, or, in a terminal, one the user picks or creates.
 */
export async function pushStaticSite(
	siteFolder: string,
	identifier: string | undefined,
	logger: Logger< string >
): Promise< Space | undefined > {
	const site = await getSiteByFolder( siteFolder );
	// Reported to the Studio apps like a WordPress.com push, so they show its progress.
	let remoteSiteId: string | undefined;
	const report = ( activity: Partial< Extract< SyncActivity, { kind: 'pending' } > > ) =>
		void reportSyncActivity( site.id, {
			kind: 'pending',
			direction: 'push',
			provider: 'spacefast',
			remoteSiteId,
			...activity,
		} );

	let space: Space | undefined;
	try {
		const config = await requireConfig();
		space = await resolveSpace( config, site.id, site.name, identifier, logger );
		if ( ! space ) {
			return undefined;
		}
		remoteSiteId = space.id;

		const outputDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-static-' ) );
		const removeOutput = () => fs.promises.rm( outputDir, { recursive: true, force: true } );
		const forgetOutput = onCancel( removeOutput );
		try {
			report( { phase: 'creatingBackup' } );
			await exportStaticSite( site.path, outputDir, space.url, true );
			await copyRootFiles( site.path, outputDir );

			logger.reportStart( 'push', formatProgressLabel( __( 'Publishing…' ), 0 ) );
			await spacefast.sites!.push(
				config,
				space,
				{ kind: 'files', files: await listFiles( outputDir ) },
				{},
				( { phase, progress } ) => {
					report( {
						phase,
						...( progress === undefined ? {} : { progress: Math.round( progress ) } ),
					} );
					logger.reportProgress(
						phase === 'uploading'
							? formatProgressLabel(
									__( 'Uploading files…' ),
									Math.round( ( progress ?? 0 ) * 0.9 )
							  )
							: formatProgressLabel( __( 'Making it live…' ), 95 )
					);
				}
			);
		} finally {
			forgetOutput();
			await removeOutput();
		}
	} catch ( error ) {
		const loggerError = toLoggerError( error, __( 'Failed to publish to Spacefast' ) );
		await reportSyncActivity( site.id, {
			kind: 'error',
			direction: 'push',
			provider: 'spacefast',
			message: loggerError.message,
		} );
		throw loggerError;
	}

	await rememberRemoteSite( 'spacefast', site.id, space, 'push' );
	await reportSyncActivity( site.id, {
		kind: 'success',
		direction: 'push',
		provider: 'spacefast',
	} );
	logger.reportSuccess( sprintf( __( 'Published to %1$s (%2$s)' ), space.name, space.url ) );
	return space;
}

// In a terminal, offers to connect Spacefast with a device sign-in.
async function requireConfig(): Promise< SpacefastConfig > {
	const config = await readProviderConfig( 'spacefast' );
	if ( config ) {
		return config;
	}
	const { label } = getProviderDescriptor( 'spacefast' );
	if (
		! process.stdin.isTTY ||
		! ( await confirm( { message: sprintf( __( 'Connect %s now?' ), label ) } ) )
	) {
		throw new LoggerError(
			sprintf( __( 'Connect %s first.' ), label ),
			undefined,
			'auth_required'
		);
	}

	const login = await spacefast.startConnect!();
	console.log(
		sprintf( __( 'Approve the code %1$s at %2$s' ), login.userCode, login.verificationUrl )
	);
	await openBrowser( login.verificationUrl ).catch( () => undefined );
	await connectProvider( spacefast, {
		deviceCode: login.deviceCode,
		interval: String( login.interval ),
		expiresAt: login.expiresAt,
	} );
	return ( await readProviderConfig( 'spacefast' ) )!;
}

async function resolveSpace(
	config: SpacefastConfig,
	localSiteId: string,
	siteName: string,
	identifier: string | undefined,
	logger: Logger< string >
): Promise< Space | undefined > {
	if ( ! identifier ) {
		const [ last ] = ( await getRemoteSites( 'spacefast', localSiteId ) ).sort( ( a, b ) =>
			( b.lastPushTimestamp ?? '' ).localeCompare( a.lastPushTimestamp ?? '' )
		);
		if ( last ) {
			const {
				localSiteId: _localSiteId,
				lastPushTimestamp: _push,
				lastPullTimestamp: _pull,
				...space
			} = last;
			return space;
		}
	}

	logger.reportStart( 'spaces', __( 'Loading your Spaces…' ) );
	let spaces: Space[];
	try {
		spaces = await spacefast.sites!.list( config );
	} catch ( error ) {
		throw toLoggerError( error, __( 'Failed to load your Spacefast Spaces' ) );
	}
	logger.spinner.stop();

	if ( identifier ) {
		const space = spaces.find( ( candidate ) => matchesSpace( candidate, identifier ) );
		if ( ! space ) {
			throw new LoggerError( sprintf( __( 'No Space matches "%s".' ), identifier ) );
		}
		return space;
	}

	if ( ! process.stdin.isTTY ) {
		throw new LoggerError(
			__( 'Choose a Space with `--remote-site spacefast:<space>` (its id, slug or URL).' )
		);
	}
	const choice = await select< Space | typeof NEW_SPACE >( {
		message: __( 'Select a Space to publish to' ),
		choices: [
			{ name: sprintf( __( 'New Space "%s"' ), siteName ), value: NEW_SPACE },
			...spaces.map( ( space ) => ( {
				name: `${ space.name } (${ space.url })`,
				value: space,
			} ) ),
		],
	} );
	if ( choice !== NEW_SPACE ) {
		return choice;
	}
	try {
		return await spacefast.sites!.create!( config, { name: siteName } );
	} catch ( error ) {
		throw toLoggerError( error, __( 'Failed to create the Space' ) );
	}
}

function matchesSpace( space: Space, identifier: string ): boolean {
	const normalize = ( value: string ) => value.replace( /^https?:\/\//, '' ).replace( /\/+$/, '' );
	return [ space.id, space.slug, normalize( space.url ) ].includes( normalize( identifier ) );
}

async function copyRootFiles( sitePath: string, outputDir: string ): Promise< void > {
	for ( const name of ROOT_FILES ) {
		try {
			await fs.promises.copyFile( path.join( sitePath, name ), path.join( outputDir, name ) );
		} catch ( error ) {
			if ( ( error as NodeJS.ErrnoException ).code !== 'ENOENT' ) {
				throw error;
			}
		}
	}
}

async function listFiles( directory: string ): Promise< PushFile[] > {
	const entries = await fs.promises.readdir( directory, { recursive: true, withFileTypes: true } );
	return Promise.all(
		entries
			.filter( ( entry ) => entry.isFile() )
			.map( async ( entry ) => {
				const absolute = path.join( entry.parentPath, entry.name );
				return {
					path: path.relative( directory, absolute ).split( path.sep ).join( '/' ),
					size: ( await fs.promises.stat( absolute ) ).size,
					read: () => fs.promises.readFile( absolute ),
				};
			} )
	);
}
