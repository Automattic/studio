import { updateStandaloneCli } from 'cli/lib/standalone-updates';
import { getCliInstallKind } from 'cli/lib/update-notifier';

if ( getCliInstallKind() === 'standalone' ) {
	void updateStandaloneCli( __STUDIO_CLI_VERSION__, { automatic: true } ).catch( () => {
		process.exitCode = 1;
	} );
}
