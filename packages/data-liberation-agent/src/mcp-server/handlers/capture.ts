import {
	captureWebsite,
	UnsupportedCapturePlatformError,
	type CaptureProgress,
} from '../../lib/capture.js';
import type { Handler } from '../handler-types.js';

export const captureHandler: Handler = async ( args, context ) => {
	const callerProgress =
		typeof args.onProgress === 'function'
			? ( args.onProgress as ( progress: CaptureProgress ) => void )
			: undefined;

	try {
		const result = await captureWebsite(
			{
				url: String( args.url ?? '' ),
				outputDir: String( args.outputDir ?? '' ),
				resume: args.resume === true,
				captureImages: args.captureImages === true,
				onProgress: ( progress ) => {
					callerProgress?.( progress );
					void context.server.sendLoggingMessage( {
						level: 'info',
						data: JSON.stringify( { type: 'capture_progress', ...progress } ),
					} );
				},
			},
			{ findAdapter: context.findAdapter }
		);
		return context.textResult( result );
	} catch ( error ) {
		if ( error instanceof UnsupportedCapturePlatformError ) {
			return context.errorResult( error.message );
		}
		throw error;
	}
};
