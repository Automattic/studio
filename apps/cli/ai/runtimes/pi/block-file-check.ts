import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { checkBlockContent, hasBlockMarkup } from 'cli/ai/block-check';
import { findSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import type { AgentTool } from '@earendil-works/pi-agent-core';

// Block theme templates and parts are live as soon as they are written.
const THEME_BLOCK_FILE =
	/^(.*)[\\/]wp-content[\\/]themes[\\/][^\\/]+[\\/](templates|parts)[\\/].+\.html$/;

/**
 * Checks the block markup of a Studio site's theme templates and parts as
 * Write and Edit save them, and adds what the block editor found to the
 * result. Lossless re-serializations are written back to the file.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withBlockFileCheck< TTool extends AgentTool< any > >(
	tool: TTool,
	cwd: string
): TTool {
	return {
		...tool,
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			const result = await tool.execute( toolCallId, params, signal, onUpdate );
			const report = await checkBlockFile(
				path.resolve( cwd, String( ( params as { path?: unknown } ).path ) )
			);
			return report
				? { ...result, content: [ ...result.content, { type: 'text', text: report } ] }
				: result;
		},
	};
}

export async function checkBlockFile( filePath: string ): Promise< string | undefined > {
	const match = THEME_BLOCK_FILE.exec( filePath );
	if ( ! match ) {
		return undefined;
	}
	const site = await findSiteByFolder( match[ 1 ] );
	if ( ! site ) {
		return undefined;
	}
	const content = await readFile( filePath, 'utf8' );
	if ( ! hasBlockMarkup( content ) ) {
		return undefined;
	}
	const label = path.relative( site.path, filePath );
	const check = await checkBlockContent( content, getSiteUrl( site ), label );
	if ( check.content !== content ) {
		await writeFile( filePath, check.content, 'utf8' );
	}
	return check.passed ? check.report : `${ check.report }\nThe file is live with these blocks.`;
}
