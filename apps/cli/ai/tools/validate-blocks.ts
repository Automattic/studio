import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { checkBlockContent } from 'cli/ai/block-check';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { resolveSite, textResult } from './utils';

function formatMarkdownFence( language: string, content: string ): string {
	const longestBacktickRun = Math.max(
		0,
		...Array.from( content.matchAll( /`+/g ), ( match ) => match[ 0 ].length )
	);
	const fence = '`'.repeat( Math.max( 3, longestBacktickRun + 1 ) );
	return `${ fence }${ language }\n${ content }\n${ fence }`;
}

// Studio Code checks block content as its own tools write it. Agents that
// write files with their own tools check theme files with this one.
export const validateBlocksTool = defineTool(
	'validate_blocks',
	"Checks block content in the site's block editor, the way the editor will load it: core/html blocks holding markup that belongs in editable blocks are reported first, then each block's save output is compared. Re-serializations the editor makes without loss are kept: written back to `filePath`, or returned as the content to use. `wp_cli post create` and `post update` run this check themselves. Theme `templates/*.html` and `parts/*.html` files are live as soon as they are written, so check each one written with your own file tools. The site must be running, with the theme and the plugins the content uses active.",
	{
		nameOrPath: Type.String( {
			description: 'The site name or file system path — the site must be running',
		} ),
		filePath: Type.Optional(
			Type.String( {
				description:
					'Path to a file containing WordPress block content — absolute, or relative to the site root',
			} )
		),
		content: Type.Optional(
			Type.String( {
				description: 'Raw WordPress block content (HTML with block comments)',
			} )
		),
	},
	async ( args, context ) => {
		const site = await resolveSite( args.nameOrPath );
		const filePath = args.filePath ? path.resolve( site.path, args.filePath ) : undefined;
		const content = filePath ? await readFile( filePath, 'utf-8' ) : args.content;
		if ( content === undefined ) {
			throw new Error( 'Either content or filePath must be provided.' );
		}
		const label = filePath
			? path.relative( site.path, filePath ).split( path.sep ).join( '/' )
			: 'content';
		context.onProgress( `Checking blocks in ${ label }…` );
		const check = await checkBlockContent( content, getSiteUrl( site ), label );
		if ( check.content === content ) {
			return textResult( check.report );
		}
		if ( filePath ) {
			await writeFile( filePath, check.content, 'utf-8' );
			return textResult( check.report );
		}
		return textResult(
			`${ check.report }\n\nContent to use:\n${ formatMarkdownFence( 'html', check.content ) }`
		);
	},
	{
		annotations: LOCAL_CHANGE,
		promptSnippet:
			"Check block content in the site's block editor; keeps lossless fixes. Theme templates and parts written with your own file tools need it.",
	}
);
