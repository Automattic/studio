import {
	NO_CHANGES,
	notesAfterCall,
	siteOfCall,
	studioMessage,
	validationLines,
	type AnyStudioAgentTool,
	type SettledChanges,
	type SiteChanges,
	type SiteNotes,
	type StudioAgentHost,
} from '@studio/agent/node';
import type { BlockValidationGate } from '@studio/agent/node/block-validation-gate';

/** What checks the calls of one MCP session, as a Studio Code session's calls are checked. */
export interface ServedChecks {
	siteNotes: SiteNotes;
	siteChanges?: SiteChanges;
	gate?: Pick< BlockValidationGate, 'settle' >;
}

// Runs a served tool for an MCP call. MCP wants `{content, isError}`; pi-native
// handlers throw — translate.
export async function runServedTool(
	host: StudioAgentHost,
	tool: AnyStudioAgentTool,
	args: Record< string, unknown >,
	{ siteNotes, siteChanges, gate }: ServedChecks
) {
	// The client changes sites between calls too, with its own file tools and
	// shell, so what changed since the last call is reported with this one.
	const since = await settled( siteChanges );
	// A call that fails can still have changed content.
	const changedContent = async ( result?: { site?: string; text: string } ) => {
		const changed = await settled( siteChanges );
		const written = [ ...since.written, ...changed.written ];
		const notes = await notesAfterCall( siteNotes, {
			written,
			site: result?.site,
			resultText: result?.text ?? '',
		} );
		const validation = gate ? await gate.settle() : undefined;
		// The fixes the checks of a written file saved are no change of the
		// client's: the next call compares with the sites as they leave them,
		// read before the client can change them again.
		if ( written.length || validation?.saved.length ) {
			await siteChanges?.snapshot().catch( () => undefined );
		}
		return [
			...since.summaries,
			...changed.summaries,
			...since.problems,
			...changed.problems,
			...notes,
			...( validation ? validationLines( validation ) : [] ),
		];
	};
	try {
		const result = await tool.rawHandler( args as never );
		const site = await siteOfCall( host, tool, args );
		const notes = studioMessage( 'notes', [
			...( await changedContent( {
				site: site?.path,
				text: result.content
					.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
					.join( '\n' ),
			} ) ),
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
