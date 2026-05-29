import { readFile } from 'fs/promises';
import { Type } from 'typebox';
import { validateHtmlBlockPolicy } from 'cli/ai/block-content-policy';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';
import { textResult } from './utils';

function formatPreview( content: string ): string {
	const compact = content.replace( /\s+/g, ' ' ).trim();
	return compact.length > 500 ? compact.slice( 0, 500 ) + '…' : compact;
}

export const validateHtmlBlocksTool = defineTool(
	'validate_html_blocks',
	'Checks core/html blocks for misuse before editor validation. Returns the invalid HTML blocks that should be rewritten as editable core or plugin blocks.',
	{
		filePath: Type.Optional(
			Type.String( {
				description: 'Path to a file containing WordPress block content to check',
			} )
		),
		content: Type.Optional(
			Type.String( {
				description: 'Raw WordPress block content (HTML with block comments) to check',
			} )
		),
	},
	async ( args ) => {
		let blockContent: string;
		let fileName = 'inline content';

		if ( args.filePath ) {
			blockContent = await readFile( args.filePath, 'utf-8' );
			fileName = args.filePath.split( '/' ).slice( -2 ).join( '/' );
		} else if ( args.content !== undefined ) {
			blockContent = args.content;
		} else {
			throw new Error( 'Either content or filePath must be provided.' );
		}

		emitProgress( `Checking HTML blocks in ${ fileName }…` );

		const report = validateHtmlBlockPolicy( blockContent );
		const lines = [
			`HTML block policy: ${ report.invalidHtmlBlocks.length }/${ report.totalHtmlBlocks } core/html blocks invalid`,
		];

		if ( report.invalidHtmlBlocks.length === 0 ) {
			lines.push(
				report.totalHtmlBlocks === 0
					? 'No core/html blocks found.'
					: 'All core/html blocks are within the allowed policy.'
			);
			return textResult( lines.join( '\n' ) );
		}

		lines.push(
			'',
			'Invalid HTML blocks:',
			...report.invalidHtmlBlocks.flatMap( ( block ) => [
				`  - #${ block.blockNumber } line ${ block.line }`,
				...block.issues.map( ( issue ) => `    ${ issue }` ),
				`    Content: ${ formatPreview( block.content ) }`,
			] ),
			'',
			'Rewrite each invalid core/html block as editable core or plugin blocks, then call validate_html_blocks again before validate_and_fix_blocks.'
		);

		return textResult( lines.join( '\n' ) );
	}
);
