// src/ui/liberate.ts
//
// URL -> complete, portable HTML site. This is the product's primary path:
// liberate every retained route into a self-contained site directory and hand
// back a runnable local copy. No WordPress, Studio, or destination-specific
// step participates here — the HTML on disk is the contract.
//
import { join } from 'node:path';
import { captureWebsite } from '../lib/capture.js';
import { siteOutputDir } from '../lib/paths.js';
import { startStaticServer } from '../lib/replicate/local-site/static-server.js';
import type { StaticServer } from '../lib/replicate/local-site/static-server.js';

export interface LiberateOptions {
	url: string;
	/** Base directory; the site lands in a per-source subdirectory. */
	outputBase: string;
	resume?: boolean;
	/** Capture PNG screenshots alongside the HTML. Default: false. */
	screenshots?: boolean;
	/** Serve the liberated site over HTTP. Default: true. */
	serve?: boolean;
	/** Learn responsive sizing across widths rather than freezing one. Default: true. */
	learnFluid?: boolean;
	log?: ( message: string ) => void;
}

export interface LiberateResult {
	outputDir: string;
	websiteDir: string;
	routesDiscovered: number;
	routesCaptured: number;
	/** Routes already on disk and reused instead of recaptured. */
	routesSkipped: number;
	routesFailed: number;
	/** Running local server, or null when serving is disabled. */
	server: StaticServer | null;
}

export async function liberateSite( options: LiberateOptions ): Promise< LiberateResult > {
	const log = options.log ?? ( () => {} );
	const outputDir = siteOutputDir( options.outputBase, options.url );

	const capture = await captureWebsite( {
		url: options.url,
		outputDir,
		resume: options.resume,
		captureImages: options.screenshots,
		learnFluid: options.learnFluid !== false,
		onProgress: ( progress ) => {
			if ( progress.phase === 'capturing' && progress.total ) {
				log(
					`[liberate] ${ progress.current ?? 0 }/${ progress.total } ${ progress.url ?? '' }`.trim()
				);
				return;
			}
			log( `[liberate] ${ progress.phase }` );
		},
	} );

	const websiteDir = join( outputDir, 'website' );
	return {
		outputDir,
		websiteDir,
		routesDiscovered: capture.summary.routesDiscovered,
		routesCaptured: capture.summary.routesCaptured,
		routesSkipped: capture.summary.routesSkipped,
		routesFailed: capture.summary.routesFailed,
		server: options.serve === false ? null : await startStaticServer( websiteDir ),
	};
}
