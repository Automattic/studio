import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import type { Config } from '@studio/common/lib/config/schema';

// What only the Desktop app keeps, in the config file's `desktop` section.
export async function readDesktopState(): Promise< Config[ 'desktop' ] > {
	return ( await readConfig() ).desktop;
}

export async function updateDesktopState( patch: Partial< Config[ 'desktop' ] > ): Promise< void > {
	await updateConfig( ( { desktop } ) => {
		Object.assign( desktop, patch );
	} );
}
