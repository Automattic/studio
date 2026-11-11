import type { SessionManager } from '@earendil-works/pi-coding-agent';

// Work tools leave running after they return (see ToolResult.pending), kept
// per chat session so that what it reports reaches the agent with the next
// tool result, in this turn or a later one.
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

const pendingWorkBySession = new WeakMap< SessionManager, PendingWork >();

export function getPendingWork( session: SessionManager ): PendingWork {
	let pendingWork = pendingWorkBySession.get( session );
	if ( ! pendingWork ) {
		pendingWork = new PendingWork();
		pendingWorkBySession.set( session, pendingWork );
	}
	return pendingWork;
}
