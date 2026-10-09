import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { generateUnifiedPatch } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { validateHtmlBlockPolicy } from 'cli/ai/block-content-policy';
import { validateBlocks, type ValidationReportBase } from 'cli/ai/block-validator';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';
import type { SiteData } from 'cli/lib/cli-config/core';

const THEME_BLOCK_FILE_PATTERN =
	/^wp-content\/themes\/([\w.-]+)\/(templates|parts)\/([\w.-]+)\.html$/;

/**
 * Once a template or template part is saved in the Site Editor, WordPress
 * renders that database copy instead of the theme file. Returns a warning for
 * the agent when the validated file is shadowed that way, or null.
 */
async function getDatabaseOverrideNote(
	site: SiteData,
	filePath: string
): Promise< string | null > {
	const relativePath = path.relative( site.path, filePath ).split( path.sep ).join( '/' );
	const match = relativePath.match( THEME_BLOCK_FILE_PATTERN );
	if ( ! match ) {
		return null;
	}
	const [ , theme, folder, slug ] = match;
	const type = folder === 'parts' ? 'wp_template_part' : 'wp_template';
	const label = folder === 'parts' ? 'template part' : 'template';
	const php = `if ( ! in_array( '${ theme }', array( get_stylesheet(), get_template() ), true ) ) { return; }
$template = get_block_template( get_stylesheet() . '//${ slug }', '${ type }' );
if ( $template && 'custom' === $template->source && $template->wp_id ) { echo 'OVERRIDE_POST_ID=' . $template->wp_id; }`;

	try {
		await using command = await runWpCliCommand( site, [ 'eval', php ] );
		const id = ( await command.response.stdoutText ).match( /OVERRIDE_POST_ID=(\d+)/ )?.[ 1 ];
		if ( ! id ) {
			return null;
		}
		return [
			`Warning: this file is not what the site renders. The ${ label } "${ slug }" was customized in the Site Editor, so WordPress renders its saved copy (${ type } post ${ id }) instead, and edits to this file do not appear on the site.`,
			`Make the same change in the saved copy: read it with \`wp post get ${ id } --field=post_content\`, apply your edit while keeping the user's other changes, validate the result, and save it with \`wp post update ${ id } <file>\`. Then tell the user. Do not delete the saved copy to make this file take effect unless the user agrees, because that discards their Site Editor changes.`,
		].join( '\n' );
	} catch {
		return null;
	}
}

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
				description:
					'Path to a file containing WordPress block content to validate and fix — absolute, or relative to the site root',
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
			const site = await resolveSite( args.nameOrPath );
			let blockContent: string;
			let fileName = 'inline content';
			let filePath: string | undefined;

			if ( args.filePath ) {
				filePath = path.resolve( site.path, args.filePath );
				blockContent = await readFile( filePath, 'utf-8' );
				fileName = filePath.split( path.sep ).slice( -2 ).join( '/' );
			} else if ( args.content !== undefined ) {
				blockContent = args.content;
			} else {
				throw new Error( 'Either content or filePath must be provided.' );
			}

			const overrideNote = filePath ? getDatabaseOverrideNote( site, filePath ) : null;
			const result = async ( lines: string[] ) => {
				const note = await overrideNote;
				return textResult( ( note ? [ ...lines, '', note ] : lines ).join( '\n' ) );
			};

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
				return result( lines );
			}

			const htmlSummary =
				htmlReport.totalHtmlBlocks === 0
					? 'HTML block policy: no core/html blocks found.'
					: `HTML block policy: all ${ htmlReport.totalHtmlBlocks } core/html blocks within policy.`;

			// Stage 2: validate (and fix) in the site's real block editor.
			context.onProgress( `Validating and fixing blocks in ${ fileName }…` );

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
				return result( [
					htmlSummary,
					`Validation: ${ report.validBlocks }/${ report.totalBlocks } blocks valid`,
					'No editor serialization fixes needed.',
				] );
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
					if ( filePath ) {
						await writeFile( filePath, fixedContent, 'utf-8' );
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

			return result( lines );
		} catch ( error ) {
			throw new Error(
				`Block validation failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet:
			"Validate block content in two stages and return a combined report. First a static core/html policy check; if it finds invalid core/html blocks it returns only those (rewrite them as editable core or plugin blocks and call again) and skips the editor. Once it passes, validates in the running site's real block editor: with filePath, applies safe editor fixes directly to the file and returns a CSS-review diff; with inline content, returns exact fixed block content plus the diff. Requires a site name or path. Call after every file write/edit that contains block content.",
	}
);
