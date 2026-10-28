import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { Type } from 'typebox';
import { z } from 'zod';
import { defineTool, READ_ONLY } from './define-tool';
import { textResult } from './utils';

// Enrich the raw snapshot JSON the CLI command emits with an explicit category
// discriminator and an expiry flag, so the agent never mistakes a temporary
// preview site for a durable connected WordPress.com remote site.
export function enrichPreviewListOutput( rawJson: string ): string {
	const snapshots = z.array( snapshotSchema ).parse( JSON.parse( rawJson ) );
	const enriched = snapshots.map( ( snapshot ) => ( {
		type: 'preview' as const,
		name: snapshot.name,
		url: `https://${ snapshot.url }`,
		atomicSiteId: snapshot.atomicSiteId,
		localSiteId: snapshot.localSiteId,
		date: snapshot.date,
		isExpired: isSnapshotExpired( snapshot ),
	} ) );
	return JSON.stringify( enriched, null, 2 );
}

export const listPreviewsTool = defineTool(
	'preview_list',
	'Lists preview sites for a local Studio site. A preview site is a TEMPORARY, expiring hosted preview created from a local site — it is NOT a connected WordPress.com remote site and must never be described as one. Each entry is tagged with "type": "preview". Requires WordPress.com authentication.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
	},
	async ( args, context ) => {
		try {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const rawJson = ( await context.host.previews.list( site ) ).trim();
			const normalizedJson = rawJson && rawJson !== 'undefined' ? rawJson : '[]';
			return textResult( enrichPreviewListOutput( normalizedJson ) );
		} catch ( error ) {
			throw new Error(
				`Failed to list preview sites: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	},
	{
		annotations: READ_ONLY,
		promptSnippet:
			'List preview sites (temporary, expiring hosted previews) for a local site. These are NOT connected WordPress.com remote sites.',
	}
);
