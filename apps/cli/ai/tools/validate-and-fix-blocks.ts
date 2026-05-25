import { readFile, writeFile } from 'fs/promises';
import { Type } from 'typebox';
import { validateBlocks, type ValidationReportBase } from 'cli/ai/block-validator';
import { createUnifiedDiff } from 'cli/ai/content-diff';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

function formatInvalidBlocks( report: ValidationReportBase ): string[] {
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

function formatMarkdownFence( language: string, content: string ): string {
	const longestBacktickRun = Math.max(
		0,
		...Array.from( content.matchAll( /`+/g ), ( match ) => match[ 0 ].length )
	);
	const fence = '`'.repeat( Math.max( 3, longestBacktickRun + 1 ) );
	return `${ fence }${ language }\n${ content }\n${ fence }`;
}

export const validateAndFixBlocksTool = defineTool(
	'validate_and_fix_blocks',
	"Validates WordPress block content in the site's real block editor. When filePath is provided, applies safe live-editor serialization fixes directly to the file and returns a diff for CSS impact review. For inline content, returns exact fixed block content plus the diff. The site must be running.",
	{
		nameOrPath: Type.String( {
			description: 'The site name or file system path — the site must be running',
		} ),
		filePath: Type.Optional(
			Type.String( {
				description: 'Path to a file containing WordPress block content to validate and fix',
			} )
		),
		content: Type.Optional(
			Type.String( {
				description: 'Raw WordPress block content (HTML with block comments) to validate and fix',
			} )
		),
	},
	async ( args ) => {
		try {
			let blockContent: string;
			let fileName = 'inline content';
			let shouldApplyFixToFile = false;

			if ( args.filePath ) {
				blockContent = await readFile( args.filePath, 'utf-8' );
				fileName = args.filePath.split( '/' ).slice( -2 ).join( '/' );
				shouldApplyFixToFile = true;
			} else if ( args.content !== undefined ) {
				blockContent = args.content;
			} else {
				throw new Error( 'Either content or filePath must be provided.' );
			}

			emitProgress( `Validating and fixing blocks in ${ fileName }…` );

			const site = await resolveSite( args.nameOrPath );
			const siteUrl = getSiteUrl( site );
			const report = await validateBlocks( blockContent, siteUrl );

			if ( report.error ) {
				emitProgress( `Validation failed for ${ fileName }: ${ report.error.slice( 0, 80 ) }` );
				throw new Error( `Block validation failed: ${ report.error }` );
			}

			if ( report.invalidBlocks === 0 ) {
				emitProgress( `${ fileName }: all ${ report.totalBlocks } blocks valid` );
				return textResult(
					[
						`Validation: ${ report.validBlocks }/${ report.totalBlocks } blocks valid`,
						'No editor serialization fixes needed.',
					].join( '\n' )
				);
			}

			const invalidNames = report.results
				.filter( ( result ) => ! result.isValid )
				.map( ( result ) => result.blockName )
				.join( ', ' );
			emitProgress( `${ fileName }: ${ report.invalidBlocks } invalid (${ invalidNames })` );

			const lines = [
				`Validation: ${ report.validBlocks }/${ report.totalBlocks } blocks valid`,
				'',
				'Invalid blocks:',
				...formatInvalidBlocks( report ),
			];

			if ( report.proposedFix ) {
				const fixedReport = report.proposedFix.report;
				if ( fixedReport.error ) {
					lines.push( '', `Auto-fix proposal failed validation: ${ fixedReport.error }` );
				} else if ( fixedReport.invalidBlocks === 0 ) {
					const fixedContent = report.proposedFix.fixedContent;
					const diff = createUnifiedDiff(
						blockContent,
						fixedContent,
						fileName,
						`${ fileName } (editor-fixed)`
					);
					if ( shouldApplyFixToFile && args.filePath ) {
						await writeFile( args.filePath, fixedContent, 'utf-8' );
						emitProgress( `${ fileName }: editor serialization fix applied` );
						lines.push(
							'',
							`Auto-fix applied: ${ fixedReport.validBlocks }/${ fixedReport.totalBlocks } blocks valid after live-editor serialization.`,
							`The fixed block content has already been written to ${ fileName }. Do not replace it manually. Use the diff only to review class/nesting changes and update CSS selectors if needed.`
						);
					} else {
						lines.push(
							'',
							`Auto-fix proposal: ${ fixedReport.validBlocks }/${ fixedReport.totalBlocks } blocks valid after live-editor serialization.`,
							'Use the fixed block content below as the replacement block content. Use the diff only to review class/nesting changes and update CSS selectors if needed.',
							'',
							'Fixed block content:',
							formatMarkdownFence( 'html', fixedContent )
						);
					}
					lines.push( '', 'Diff for CSS review:', '```diff', diff, '```' );
				} else {
					lines.push(
						'',
						`Auto-fix proposal still has ${ fixedReport.invalidBlocks } invalid block(s), so no trusted diff is returned.`,
						'Remaining invalid blocks:',
						...formatInvalidBlocks( fixedReport )
					);
				}
			} else {
				lines.push( '', 'No automatic editor serialization fix was available.' );
			}

			return textResult( lines.join( '\n' ) );
		} catch ( error ) {
			throw new Error(
				`Block validation failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
