import { NO_CHANGES, type SiteChanges, type SettledChanges } from 'cli/ai/site-changes';
import { studioMessage, validationLines } from 'cli/ai/studio-message';
import { siteOfCall } from 'cli/ai/tools/utils';
import type { SiteNotes } from 'cli/ai/site-notes';
import type { AnyStudioAgentTool } from 'cli/ai/tools/define-tool';

// Runs a served tool for an MCP call. MCP wants `{content, isError}`; pi-native
// handlers throw — translate.
export async function runServedTool(
	tool: AnyStudioAgentTool,
	args: Record< string, unknown >,
	siteNotes: SiteNotes,
	siteChanges?: SiteChanges
) {
	// The client changes sites between calls too, with its own file tools and
	// shell, so what changed since the last call is reported with this one.
	const since = await settled( siteChanges );
	// A call that fails can still have changed content.
	const changedContent = async () => {
		const changed = await settled( siteChanges );
		return [
			...validationLines( {
				summaries: [ ...since.summaries, ...changed.summaries ],
				problems: [ ...since.problems, ...changed.problems ],
			} ),
			...(
				await Promise.all(
					[ ...new Set( [ ...since.written, ...changed.written ] ) ].map( ( file ) =>
						siteNotes.afterWrite( file )
					)
				)
			).flat(),
		];
	};
	try {
		const result = await tool.rawHandler( args as never );
		const changed = await changedContent();
		const resultText = result.content
			.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
			.join( '\n' );
		const site = await siteOfCall( tool, args );
		const notes = studioMessage( 'notes', [
			...changed,
			...( site ? await siteNotes.afterResult( site.path, resultText ) : [] ),
			await result.pending,
		] );
		return {
			content: notes
				? [ ...result.content, { type: 'text' as const, text: notes } ]
				: result.content,
			_meta: result._meta,
			isError: false,
		};
	} catch ( error ) {
		const message = [
			error instanceof Error ? error.message : String( error ),
			studioMessage( 'notes', await changedContent() ),
		]
			.filter( Boolean )
			.join( '\n' );
		return {
			content: [ { type: 'text' as const, text: message } ],
			isError: true,
		};
	}
}

async function settled( siteChanges?: SiteChanges ): Promise< SettledChanges > {
	return ( await siteChanges?.settle().catch( () => undefined ) ) ?? NO_CHANGES;
}
