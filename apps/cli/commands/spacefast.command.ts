import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const publishBuilder = ( yargs: StudioArgv ) => {
	return yargs
		.option( 'space', {
			type: 'string',
			description: __( 'ID or slug of the Space to publish to' ),
		} )
		.option( 'new-space', {
			type: 'string',
			description: __( 'Create a Space with this title (defaults to the site name)' ),
		} )
		.option( 'team', {
			type: 'string',
			description: __( 'ID of the team to create the new Space in (defaults to your first team)' ),
		} )
		.conflicts( 'space', 'new-space' );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command(
		'spacefast',
		__( 'Publish sites as static files to Spacefast' ),
		( yargs ) =>
			yargs
				.command( {
					command: 'login',
					describe: __( 'Log in to Spacefast' ),
					handler: async () => {
						const { loginHandler } = await import( 'cli/commands/spacefast' );
						return loginHandler();
					},
				} )
				.command( {
					command: 'logout',
					describe: __( 'Log out of Spacefast' ),
					handler: async () => {
						const { logoutHandler } = await import( 'cli/commands/spacefast' );
						return logoutHandler();
					},
				} )
				.command( {
					command: 'publish',
					describe: __( 'Export the site as static files and publish it to a Space' ),
					builder: publishBuilder,
					handler: async ( argv ) => {
						const { publishHandler } = await import( 'cli/commands/spacefast' );
						return publishHandler( argv );
					},
				} )
				.demandCommand( 1, __( 'You must provide a valid spacefast command' ) )
	);
};
