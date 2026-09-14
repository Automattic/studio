import { readFile, writeFile } from 'fs/promises';
import { generateUnifiedPatch } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { validateHtmlBlockPolicy } from 'cli/ai/block-content-policy';
import { validateBlocks, type ValidationReportBase } from 'cli/ai/block-validator';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

function formatPreview( content: string ): string {
	const compact = content.replace( /\s+/g, ' ' ).trim();
	return compact.length > 500 ? compact.slice( 0, 500 ) + '…' : compact;
}

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

export const validateBlocksTool = defineTool(
	'validate_blocks',
	"Validates WordPress block content in two stages and returns a combined report. First runs a static core/html block policy check; if it finds invalid core/html blocks, it returns only those (rewrite them as editable core or plugin blocks and call again) without touching the editor. Once the policy check passes, it validates the content in the site's real block editor: with filePath it applies safe live-editor serialization fixes directly to the file and returns a CSS-review diff; with inline content it returns the exact fixed block content plus the diff. The site must be running.",
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
	async ( args, context ) => {
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

			// Stage 1: static core/html policy check. Acts as a gate — if it
			// fails we stop here instead of paying the live-editor round-trip on
			// content we already know needs rewriting.
			context.onProgress( `Checking HTML blocks in ${ fileName }…` );
			const htmlReport = validateHtmlBlockPolicy( blockContent );

			if ( htmlReport.invalidHtmlBlocks.length > 0 ) {
				context.onProgress(
					`${ fileName }: ${ htmlReport.invalidHtmlBlocks.length }/${ htmlReport.totalHtmlBlocks } core/html blocks invalid`
				);
				const lines = [
					`HTML block policy: ${ htmlReport.invalidHtmlBlocks.length }/${ htmlReport.totalHtmlBlocks } core/html blocks invalid`,
					'',
					'Invalid HTML blocks:',
					...htmlReport.invalidHtmlBlocks.flatMap( ( block ) => [
						`  - #${ block.blockNumber } line ${ block.line }`,
						...block.issues.map( ( issue ) => `    ${ issue }` ),
						`    Content: ${ formatPreview( block.content ) }`,
					] ),
					'',
					'Rewrite each invalid core/html block as editable core or plugin blocks, then call validate_blocks again. Editor validation was skipped until the HTML policy passes.',
				];
				return textResult( lines.join( '\n' ) );
			}

			const htmlSummary =
				htmlReport.totalHtmlBlocks === 0
					? 'HTML block policy: no core/html blocks found.'
					: `HTML block policy: all ${ htmlReport.totalHtmlBlocks } core/html blocks within policy.`;

			// Stage 2: validate (and fix) in the site's real block editor.
			context.onProgress( `Validating and fixing blocks in ${ fileName }…` );

			const site = await resolveSite( args.nameOrPath );
			const siteUrl = getSiteUrl( site );
			const report = await validateBlocks( blockContent, siteUrl );

			if ( report.error ) {
				context.onProgress(
					`Validation failed for ${ fileName }: ${ report.error.slice( 0, 80 ) }`
				);
				throw new Error( `Block validation failed: ${ report.error }` );
			}

			if ( report.invalidBlocks === 0 ) {
				context.onProgress( `${ fileName }: all ${ report.totalBlocks } blocks valid` );
				return textResult(
					[
						htmlSummary,
						`Validation: ${ report.validBlocks }/${ report.totalBlocks } blocks valid`,
						'No editor serialization fixes needed.',
					].join( '\n' )
				);
			}

			const invalidNames = report.results
				.filter( ( result ) => ! result.isValid )
				.map( ( result ) => result.blockName )
				.join( ', ' );
			context.onProgress( `${ fileName }: ${ report.invalidBlocks } invalid (${ invalidNames })` );

			const lines = [
				htmlSummary,
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
					const diff = generateUnifiedPatch( fileName, blockContent, fixedContent );
					if ( shouldApplyFixToFile && args.filePath ) {
						await writeFile( args.filePath, fixedContent, 'utf-8' );
						context.onProgress( `${ fileName }: editor serialization fix applied` );
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
