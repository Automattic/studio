import { snapshotSchema } from '@studio/common/types/snapshot';
import { Type } from 'typebox';
import { z } from 'zod';
import { runCommand as runListPreviewCommand } from 'cli/commands/preview/list';
import { isSnapshotExpired } from 'cli/lib/snapshots';
import { defineTool } from './define-tool';
import { captureConsoleOutput, resolveSite, textResult } from './utils';

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
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const rawJson = (
				await captureConsoleOutput( () => runListPreviewCommand( site.path, 'json' ) )
			).trim();
			const normalizedJson = rawJson && rawJson !== 'undefined' ? rawJson : '[]';
			return textResult( enrichPreviewListOutput( normalizedJson ) );
		} catch ( error ) {
			throw new Error(
				`Failed to list preview sites: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}
);
