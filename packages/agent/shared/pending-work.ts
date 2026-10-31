import type { StudioToolResultDetails } from './tools/define-tool';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';

// Work tools leave running after they return (see ToolResult.pending), so
// that what it reports reaches the agent with the next tool result.
export class PendingWork {
	private readonly running = new Set< Promise< void > >();
	private readonly reports: string[] = [];

	add( pending: Promise< string | undefined > ): void {
		const settled: Promise< void > = pending
			.then(
				( report ) => {
					if ( report ) {
						this.reports.push( report );
					}
				},
				( error ) => {
					this.reports.push( error instanceof Error ? error.message : String( error ) );
				}
			)
			.finally( () => this.running.delete( settled ) );
		this.running.add( settled );
	}

	async settle(): Promise< void > {
		while ( this.running.size > 0 ) {
			await Promise.all( this.running );
		}
	}

	takeReports(): string | undefined {
		return this.reports.splice( 0 ).join( '\n' ) || undefined;
	}
}

// Runs a tool call the way every runtime does: a tool that renders the site
// first waits for background work, work the tool leaves running is tracked, and
// the result gets what that work reported and the notes Studio adds.
export async function runWithPendingWork<
	R extends { content: AgentToolResult< unknown >[ 'content' ]; details?: unknown },
>(
	{
		settles,
		pendingWork,
		resultNotes,
	}: {
		settles: boolean | undefined;
		pendingWork: PendingWork;
		resultNotes?: ( text: string ) => Promise< string >;
	},
	run: () => Promise< R >
): Promise< R > {
	if ( settles ) {
		await pendingWork.settle();
	}
	const result = await run();
	const details = result.details as StudioToolResultDetails | undefined;
	if ( details?.pending ) {
		pendingWork.add( details.pending );
		delete details.pending;
	}
	const resultText = result.content
		.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
		.join( '\n' );
	const notes = [ await resultNotes?.( resultText ), pendingWork.takeReports() ]
		.filter( Boolean )
		.join( '\n' );
	return notes
		? { ...result, content: [ ...result.content, { type: 'text', text: notes } ] }
		: result;
}
