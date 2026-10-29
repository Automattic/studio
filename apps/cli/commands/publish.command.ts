import { __ } from '@wordpress/i18n';
import { publishOperation } from 'cli/lib/publish-operation';
import { createPublishServices } from 'cli/lib/publish-services';
import type { StudioArgv } from 'cli/types';
export function registerCommand( yargs: StudioArgv ) {
	return yargs.command( {
		command: 'publish',
		describe: __( 'Publish a local site and verify its content and visibility (prototype)' ),
		builder: ( args ) =>
			args
				.option( 'remote-site', {
					type: 'string',
					demandOption: true,
					description: __( 'Exact remote site ID or HTTPS URL' ),
				} )
				.option( 'visibility', {
					type: 'string',
					choices: [ 'preserve', 'private' ] as const,
					default: 'preserve',
				} )
				.option( 'output', {
					type: 'string',
					demandOption: true,
					description: __( 'Absolute publication receipt directory' ),
				} )
				.option( 'check', {
					type: 'boolean',
					default: false,
					description: __( 'Resolve the destination without publishing' ),
				} )
				.option( 'verify-only', {
					type: 'boolean',
					default: false,
					description: __( 'Verify an existing transfer without uploading again' ),
				} )
				.option( 'operation-id', { type: 'string' } ),
		handler: async ( args ) => {
			const controller = new AbortController();
			const cancel = () => controller.abort();
			process.on( 'SIGINT', cancel );
			process.on( 'SIGTERM', cancel );
			try {
				if ( args.check && args.verifyOnly ) throw new Error( 'Choose check or verify-only.' );
				await publishOperation(
					{
						sitePath: args.path,
						remoteSite: args.remoteSite,
						visibility: args.visibility as 'preserve' | 'private',
						directory: args.output,
						mode: args.check ? 'plan' : args.verifyOnly ? 'verify' : 'publish',
						operationId: args.operationId,
					},
					await createPublishServices( args.path ),
					( event ) => process.stdout.write( JSON.stringify( event ) + '\n' ),
					controller.signal
				);
			} catch ( error ) {
				process.stderr.write( ( error as Error ).message + '\n' );
				process.exitCode = 1;
			} finally {
				process.off( 'SIGINT', cancel );
				process.off( 'SIGTERM', cancel );
			}
		},
	} );
}
