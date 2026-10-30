import { app } from 'electron';
import path from 'path';

export function replaceSpotlightEntries( entries: string ): Promise< void > {
	const bridge = require( path.join( app.getAppPath(), 'native', 'spotlight.node' ) ) as {
		replaceEntries( entries: string ): Promise< void >;
	};
	return bridge.replaceEntries( entries );
}
