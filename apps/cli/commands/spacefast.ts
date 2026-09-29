import {
	listSpacefastSpaces,
	listSpacefastTeams,
	startSpacefastDeviceLogin,
	waitForSpacefastDeviceLogin,
} from '@studio/common/lib/spacefast/api';
import {
	clearSpacefastAuth,
	getSpacefastConnection,
	readSpacefastAuth,
	saveSpacefastAuth,
} from '@studio/common/lib/spacefast/config';
import { publishSiteToSpacefast } from '@studio/common/sites/spacefast';
import { __, sprintf } from '@wordpress/i18n';
import { runCommand as exportStaticSite } from 'cli/commands/export-static';
import { openBrowser } from 'cli/lib/browser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SpacefastPublishTarget } from '@studio/common/types/spacefast';

const logger = new Logger< string >();

async function login(): Promise< void > {
	const deviceLogin = await startSpacefastDeviceLogin();
	console.log(
		sprintf(
			__( 'Approve the sign-in with code %1$s at %2$s' ),
			deviceLogin.userCode,
			deviceLogin.verificationUrl
		)
	);
	await openBrowser( deviceLogin.verificationUrl ).catch( () => undefined );
	logger.reportStart( 'login', __( 'Waiting for approval…' ) );
	await saveSpacefastAuth( await waitForSpacefastDeviceLogin( deviceLogin ) );
	logger.reportSuccess( __( 'Signed in to Spacefast' ) );
}

async function publish(
	sitePath: string,
	{ space, newSpace }: { space?: string; newSpace?: string }
): Promise< void > {
	const auth = await readSpacefastAuth();
	if ( ! auth ) {
		throw new LoggerError( __( 'Sign in first with `studio spacefast login`.' ) );
	}
	const site = await getSiteByFolder( sitePath );

	let target: SpacefastPublishTarget;
	if ( newSpace !== undefined ) {
		const [ team ] = await listSpacefastTeams( auth.apiKey );
		if ( ! team ) {
			throw new LoggerError( __( 'Your Spacefast account has no team to create a Space in.' ) );
		}
		target = { teamId: team.id, title: newSpace || site.name };
	} else if ( space ) {
		const match = ( await listSpacefastSpaces( auth.apiKey ) ).find(
			( { id, slug } ) => id === space || slug === space
		);
		if ( ! match ) {
			throw new LoggerError( sprintf( __( 'No Spacefast Space matches %s.' ), space ) );
		}
		target = { spaceId: match.id };
	} else {
		const connection = await getSpacefastConnection( site.id );
		if ( ! connection ) {
			throw new LoggerError(
				__( 'This site has not been published yet. Pass --space or --new-space.' )
			);
		}
		target = { spaceId: connection.spaceId };
	}

	const connection = await publishSiteToSpacefast(
		{
			apiKey: auth.apiKey,
			exportStaticSite: ( outputDir ) => exportStaticSite( sitePath, outputDir, undefined, false ),
			onProgress: ( progress ) => {
				if ( progress.phase === 'uploading' ) {
					logger.reportStart(
						'publish',
						sprintf( __( 'Uploading %1$d of %2$d files…' ), progress.uploaded, progress.total )
					);
				} else if ( progress.phase === 'finalizing' ) {
					logger.reportStart( 'publish', __( 'Publishing the new version…' ) );
				}
			},
		},
		{ siteId: site.id, target }
	);
	logger.reportSuccess( sprintf( __( 'Published to %s' ), connection.liveUrl ) );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command(
		'spacefast',
		__( 'Publish sites as static files to Spacefast' ),
		( yargs ) =>
			yargs
				.command( {
					command: 'login',
					describe: __( 'Sign in to Spacefast' ),
					handler: () => run( login ),
				} )
				.command( {
					command: 'logout',
					describe: __( 'Sign out of Spacefast' ),
					handler: () =>
						run( async () => {
							await clearSpacefastAuth();
							logger.reportSuccess( __( 'Signed out of Spacefast' ) );
						} ),
				} )
				.command( {
					command: 'publish',
					describe: __( 'Export the site as static files and publish it to a Space' ),
					builder: ( yargs ) =>
						yargs
							.option( 'space', {
								type: 'string',
								description: __( 'ID or slug of the Space to publish to' ),
							} )
							.option( 'new-space', {
								type: 'string',
								description: __( 'Create a Space with this title (defaults to the site name)' ),
							} )
							.conflicts( 'space', 'new-space' ),
					handler: ( argv ) =>
						run( () => publish( argv.path, { space: argv.space, newSpace: argv.newSpace } ) ),
				} )
				.demandCommand( 1, __( 'You must provide a valid spacefast command' ) )
	);
};

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
