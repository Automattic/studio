import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __ } from '@wordpress/i18n';
import { openBrowser } from 'cli/lib/browser';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { StudioArgv } from 'cli/types';

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'ui',
		describe: __( 'Start the local Studio web UI and open it in your browser' ),
		builder: ( uiYargs: StudioArgv ) =>
			uiYargs
				.option( 'port', {
					type: 'number',
					description: __( 'Port to listen on' ),
				} )
				.option( 'open', {
					type: 'boolean',
					default: true,
					description: __( 'Open the UI in your default browser' ),
				} )
				.option( 'path', { hidden: true } ),
		handler: async ( argv ) => {
			// `@studio/local` is bundled into the CLI from source (see the vite
			// alias); the dynamic import keeps Express off the startup path of
			// every other command.
			const [ { startLocalServer }, { getSessionsDirectory }, { STUDIO_SITES_ROOT } ] =
				await Promise.all( [
					import( '@studio/local' ),
					import( '@studio/common/lib/well-known-paths' ),
					import( 'cli/lib/site-paths' ),
				] );

			// The server forks this same CLI for site + agent operations. When run
			// from the packaged CLI, `process.argv[1]` is that binary;
			// `STUDIO_CLI_BIN` overrides it for development.
			const cliBinary = process.env.STUDIO_CLI_BIN ?? process.argv[ 1 ];

			// Everything forked from here inherits this, so browser usage isn't counted as
			// bare CLI. `v2` because the browser serves `apps/ui`.
			process.env.STUDIO_TRACKS_ORIGIN = 'studio-web:v2';

			// The built browser UI (apps/ui `dist-local`) is copied next to the CLI
			// bundle at build time. In dev it may be absent — the server then
			// serves the API only and the UI is run via
			// `npm run dev:local --workspace=apps/ui`.
			const uiDist =
				process.env.STUDIO_LOCAL_UI_DIST ??
				path.join( path.dirname( fileURLToPath( import.meta.url ) ), 'ui' );

			const server = await startLocalServer( {
				cliBinary,
				sessionsRoot: getSessionsDirectory(),
				sitesRoot: STUDIO_SITES_ROOT,
				port: argv.port as number | undefined,
				uiDist,
				// The CLI wrapper owns the opt-out and the common props.
				recordTracksEvent: ( event, props ) =>
					recordTracksEvent( event, { ...getTracksOrigin(), ...props } ),
			} );

			// The browser UI's equivalent of the desktop's `appBoot` launch event. No
			// `is_first_launch`: the marker the desktop reads lives in its own `app.json`,
			// and the install id is shared, so neither can tell a first browser launch
			// from a first desktop one.
			void recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH, { ...getTracksOrigin() } ).catch(
				() => undefined
			);

			console.log( '' );
			console.log( __( 'WordPress Studio is running at:' ) );
			console.log( `  ${ server.url }` );
			console.log( '' );
			console.log( __( 'Press Ctrl+C to stop.' ) );

			if ( argv.open ) {
				await openBrowser( server.url ).catch( () => undefined );
			}

			const shutdown = () => {
				void server.close().finally( () => process.exit( 0 ) );
			};
			process.on( 'SIGINT', shutdown );
			process.on( 'SIGTERM', shutdown );
		},
	} );
};
