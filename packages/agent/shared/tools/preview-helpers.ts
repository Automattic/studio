import { textResult } from './utils';

// Shared by the preview tools: the text `fn` returns, or its failure as a tool error.
export async function runPreviewCommand( fn: () => Promise< string >, errorPrefix: string ) {
	try {
		return textResult( await fn() );
	} catch ( error ) {
		throw new Error(
			`${ errorPrefix }: ${ error instanceof Error ? error.message : String( error ) }`
		);
	}
}
