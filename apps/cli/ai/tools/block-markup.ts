import { Type } from 'typebox';
import { insertedBlock, type InsertedBlock } from 'cli/ai/block-validator';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { defineTool, READ_ONLY } from './define-tool';
import { resolveSite, textResult } from './utils';

/** The block as text, for the agent to write from. */
export function describeInsertedBlock( block: InsertedBlock, variation?: string ): string {
	const others = block.namespace.length
		? `Other blocks in its namespace: ${ block.namespace.join( ', ' ) }.`
		: undefined;
	if ( ! block.title ) {
		return [ `${ block.name } is not registered on the site.`, others ]
			.filter( Boolean )
			.join( '\n' );
	}
	const markup = block.markup
		? `What the editor inserts${
				block.variation ? ` for the ${ block.variation } variation` : ''
		  }:\n${ block.markup }`
		: `${ block.title } (${ block.name }) has no ${ variation } variation in the inserter.`;
	return [
		markup,
		block.variations.length
			? `Its variations in the inserter: ${ block.variations.join( '; ' ) }.`
			: undefined,
		block.children.length
			? `Blocks that go inside it: ${ block.children.join( ', ' ) }.`
			: undefined,
		others,
	]
		.filter( Boolean )
		.join( '\n\n' );
}

export const blockMarkupTool = defineTool(
	'block_markup',
	"Gets the markup the site's block editor inserts for a block, with the blocks of the site's active plugins: the block as the inserter adds it, its inserter variations, the blocks that go inside it, and the other blocks in its namespace.",
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
		block: Type.String( { description: 'The block name, such as jetpack/contact-form' } ),
		variation: Type.Optional(
			Type.String( { description: "One of the block's inserter variations, by name" } )
		),
	},
	async ( args ) => {
		const site = await resolveSite( args.nameOrPath );
		if ( ! ( await isServerRunning( site.id ) ) ) {
			throw new Error(
				`${ site.name } is not running, and the block editor runs on the site. Start it with site_start.`
			);
		}
		const block = await insertedBlock( args.block, getSiteUrl( site ), args.variation );
		return textResult( describeInsertedBlock( block, args.variation ) );
	},
	{
		annotations: READ_ONLY,
	}
);
