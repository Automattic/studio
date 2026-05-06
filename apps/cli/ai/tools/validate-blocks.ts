import { readFile } from 'fs/promises';
import { Type } from 'typebox';
import { validateBlocks, type ValidationReport } from 'cli/ai/block-validator';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

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

export const validateBlocksTool = defineTool(
	'validate_blocks',
	"Validates WordPress block content by running each block through its save() function in the site's block editor (real browser). " +
		'The site must be running. Returns per-block validation results with expected HTML for invalid blocks.',
	{
		nameOrPath: Type.String( {
			description: 'The site name or file system path — the site must be running',
		} ),
		filePath: Type.Optional(
			Type.String( {
				description: 'Path to a file containing WordPress block content to validate',
			} )
		),
		content: Type.Optional(
			Type.String( {
				description: 'Raw WordPress block content (HTML with block comments) to validate',
			} )
		),
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
				throw new Error( 'Either content or filePath must be provided.' );
			}

			emitProgress( `Validating blocks in ${ fileName }…` );

			const site = await resolveSite( args.nameOrPath );
			const siteUrl = getSiteUrl( site );
			const report = await validateBlocks( blockContent, siteUrl );

			if ( report.error ) {
				emitProgress( `Validation failed for ${ fileName }: ${ report.error.slice( 0, 80 ) }` );
				throw new Error( `Block validation failed: ${ report.error }` );
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
				lines.push(
					'',
					'Before fixing: each Expected/Actual diff is a structural change, not a literal text swap. Classes the validator adds or removes (has-X-color, alignwide, is-style-Y, wp-block-*-is-layout-flex) pull in or strip core CSS that drives layout, spacing, and color. Diff the markup explicitly, update any style.css selectors that target the old class or nesting in the same edit batch, preserve your intentional className hooks, then take a screenshot of desktop and mobile to verify the design did not drift.'
				);
			}

			return textResult( lines.join( '\n' ) );
		} catch ( error ) {
			throw new Error(
				`Block validation failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
