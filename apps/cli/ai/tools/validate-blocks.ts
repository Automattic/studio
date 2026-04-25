import { readFile } from 'fs/promises';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { validateBlocks, type ValidationReport } from 'cli/ai/block-validator';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { emitProgress } from 'cli/logger';
import { errorResult, resolveSite, textResult } from './utils';

/**
 * Render the invalid-block portion of a validation report as a list of
 * indented lines suitable for the agent's tool result. Private to this
 * module — only the validate_blocks tool consumes it.
 */
function formatInvalidBlocks( report: ValidationReport ): string[] {
	const lines: string[] = [];
	for ( const result of report.results ) {
		if ( ! result.isValid ) {
			lines.push( `  - ${ result.blockName }` );
			for ( const issue of result.issues ) {
				lines.push( `    ${ issue }` );
			}
			if ( result.expectedContent !== undefined ) {
				lines.push( `    Expected: ${ result.expectedContent }` );
				lines.push( `    Actual:   ${ result.originalContent }` );
			}
		}
	}
	return lines;
}

export const validateBlocksTool = tool(
	'validate_blocks',
	"Validates WordPress block content by running each block through its save() function in the site's block editor (real browser). " +
		'The site must be running. Returns per-block validation results with expected HTML for invalid blocks.',
	{
		nameOrPath: z
			.string()
			.describe( 'The site name or file system path — the site must be running' ),
		filePath: z
			.string()
			.optional()
			.describe( 'Path to a file containing WordPress block content to validate' ),
		content: z
			.string()
			.optional()
			.describe( 'Raw WordPress block content (HTML with block comments) to validate' ),
	},
	async ( args ) => {
		try {
			let blockContent: string;
			let fileName = 'inline content';

			if ( args.filePath ) {
				blockContent = await readFile( args.filePath, 'utf-8' );
				fileName = args.filePath.split( '/' ).slice( -2 ).join( '/' );
			} else if ( args.content ) {
				blockContent = args.content;
			} else {
				return errorResult( 'Either content or filePath must be provided.' );
			}

			emitProgress( `Validating blocks in ${ fileName }…` );

			const site = await resolveSite( args.nameOrPath );
			const siteUrl = getSiteUrl( site );
			const report = await validateBlocks( blockContent, siteUrl );

			if ( report.error ) {
				emitProgress( `Validation failed for ${ fileName }: ${ report.error.slice( 0, 80 ) }` );
				return errorResult( `Block validation failed: ${ report.error }` );
			}

			if ( report.invalidBlocks > 0 ) {
				const invalidNames = report.results
					.filter( ( r ) => ! r.isValid )
					.map( ( r ) => r.blockName )
					.join( ', ' );
				emitProgress( `${ fileName }: ${ report.invalidBlocks } invalid (${ invalidNames })` );
			} else {
				emitProgress( `${ fileName }: all ${ report.totalBlocks } blocks valid` );
			}

			const lines = [ `Validation: ${ report.validBlocks }/${ report.totalBlocks } blocks valid` ];

			if ( report.invalidBlocks > 0 ) {
				lines.push( '', 'Invalid blocks:', ...formatInvalidBlocks( report ) );
			}

			return textResult( lines.join( '\n' ) );
		} catch ( error ) {
			return errorResult(
				`Block validation failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
