import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

/**
 * Triggers the CLI `_migrate` command to copy appdata-v1.json from the
 * platform-specific Electron location to ~/.studio/appdata.json.
 */
export async function migrateAppdataViaCli(): Promise< void > {
	return new Promise< void >( ( resolve ) => {
		const [ emitter ] = executeCliCommand( [ '_migrate' ], { output: 'ignore' } );

		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', () => {
			console.warn( 'CLI _migrate command failed. This may be expected with an older CLI.' );
			resolve();
		} );
		emitter.on( 'error', () => {
			console.warn( 'CLI _migrate command errored. This may be expected with an older CLI.' );
			resolve();
		} );
	} );
}
