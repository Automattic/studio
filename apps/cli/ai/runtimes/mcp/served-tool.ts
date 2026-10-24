import { resolveSite } from 'cli/ai/tools/utils';
import type { PostContentCheck } from 'cli/ai/post-content-check';
import type { SiteNotes } from 'cli/ai/site-notes';
import type { AnyStudioAgentTool } from 'cli/ai/tools/define-tool';

// The site an MCP call works on is the one it names.
async function siteNamed( args: Record< string, unknown > ) {
	if ( typeof args.nameOrPath !== 'string' ) {
		return undefined;
	}
	try {
		return await resolveSite( args.nameOrPath );
	} catch {
		return undefined;
	}
}

// Runs a served tool for an MCP call. MCP wants `{content, isError}`; pi-native
// handlers throw — translate.
export async function runServedTool(
	tool: AnyStudioAgentTool,
	args: Record< string, unknown >,
	siteNotes: SiteNotes,
	postContent?: PostContentCheck
) {
	await postContent?.snapshot().catch( () => undefined );
	// A call that fails can still have changed content.
	const changedContent = async () => {
		const { summaries, problems } = ( await postContent?.settle().catch( () => undefined ) ) ?? {
			summaries: [],
			problems: [],
		};
		return [ ...summaries.map( ( line ) => `Block validation: ${ line }` ), ...problems ];
	};
	try {
		const result = await tool.rawHandler( args as never );
		const changed = await changedContent();
		const resultText = result.content
			.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
			.join( '\n' );
		const site = await siteNamed( args );
		const notes = [
			...changed,
			...( site ? await siteNotes.afterResult( site.path, resultText ) : [] ),
			await result.pending,
		]
			.filter( Boolean )
			.join( '\n' );
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
			...( await changedContent() ),
		].join( '\n' );
		return {
			content: [ { type: 'text' as const, text: message } ],
			isError: true,
		};
	}
}
