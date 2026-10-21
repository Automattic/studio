import { generateUnifiedPatch } from '@earendil-works/pi-coding-agent';
import { validateHtmlBlockPolicy } from 'cli/ai/block-content-policy';
import { validateBlocks, type ValidationReportBase } from 'cli/ai/block-validator';

export interface BlockCheck {
	// False when the editor rejects blocks it has no lossless fix for.
	passed: boolean;
	// What to keep: the editor's lossless re-serialization when it made one, otherwise the input.
	content: string;
	// What the check found, for the agent.
	report: string;
}

export function hasBlockMarkup( content: string ): boolean {
	return /<!--\s+wp:/.test( content );
}

function formatPreview( content: string ): string {
	const compact = content.replace( /\s+/g, ' ' ).trim();
	return compact.length > 500 ? compact.slice( 0, 500 ) + '…' : compact;
}

function formatInvalidBlocks( report: ValidationReportBase ): string[] {
	return report.results
		.filter( ( result ) => ! result.isValid )
		.flatMap( ( result ) => [
			`  - ${ result.blockName }`,
			...result.issues.map( ( issue ) => `    ${ issue }` ),
			...( result.expectedContent !== undefined
				? [
						`    Expected: ${ result.expectedContent }`,
						`    Actual:   ${ result.originalContent }`,
				  ]
				: [] ),
		] );
}

/**
 * Checks block content the way the site's block editor will load it: the
 * static core/html policy first, then the editor's own parse and save
 * comparison. Re-serializations the editor makes losslessly are applied.
 */
export async function checkBlockContent(
	content: string,
	siteUrl: string,
	label: string
): Promise< BlockCheck > {
	const htmlReport = validateHtmlBlockPolicy( content );
	if ( htmlReport.invalidHtmlBlocks.length > 0 ) {
		return {
			passed: false,
			content,
			report: [
				`${ label }: ${ htmlReport.invalidHtmlBlocks.length }/${ htmlReport.totalHtmlBlocks } core/html blocks hold markup that belongs in editable core or plugin blocks:`,
				...htmlReport.invalidHtmlBlocks.flatMap( ( block ) => [
					`  - #${ block.blockNumber } line ${ block.line }`,
					...block.issues.map( ( issue ) => `    ${ issue }` ),
					`    Content: ${ formatPreview( block.content ) }`,
				] ),
			].join( '\n' ),
		};
	}

	const report = await validateBlocks( content, siteUrl );
	if ( report.error ) {
		return {
			passed: true,
			content,
			report: `${ label }: not checked in the block editor (${ report.error }).`,
		};
	}
	if ( report.invalidBlocks === 0 ) {
		return {
			passed: true,
			content,
			report: `${ label }: all ${ report.totalBlocks } blocks valid in the block editor.`,
		};
	}

	const fix = report.proposedFix;
	if ( fix && ! fix.report.error && fix.report.invalidBlocks === 0 ) {
		const names = report.results
			.filter( ( result ) => ! result.isValid )
			.map( ( result ) => result.blockName );
		return {
			passed: true,
			content: fix.fixedContent,
			report: [
				`${ label }: the block editor re-serialized ${ names.length } block(s) (${ [
					...new Set( names ),
				].join(
					', '
				) }); the re-serialized markup is what was kept. Classes in the diff may need matching CSS selectors.`,
				'```diff',
				generateUnifiedPatch( label, content, fix.fixedContent ),
				'```',
			].join( '\n' ),
		};
	}

	return {
		passed: false,
		content,
		report: [
			`${ label }: the block editor rejects ${ report.invalidBlocks }/${ report.totalBlocks } blocks:`,
			...formatInvalidBlocks( fix && ! fix.report.error ? fix.report : report ),
		].join( '\n' ),
	};
}
