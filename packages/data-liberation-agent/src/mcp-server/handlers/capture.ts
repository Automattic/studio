import { safeFetch } from '../../lib/media-fetch/safe-fetch.js';
import { extractHandler } from './extract.js';
import type { Handler } from '../handler-types.js';

export const captureHandler: Handler = async ( args, ctx ) => {
	const response = await safeFetch( String( args.url ?? '' ), { timeoutMs: 10_000 } );
	return extractHandler(
		{
			...args,
			url: response.finalUrl,
			screenshots: true,
			dryRun: false,
			publicUrlsOnly: true,
		},
		ctx
	);
};
