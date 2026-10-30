// Work tools leave running after they return (see ToolResult.pending), kept
// per chat session so that what it reports reaches the agent with the next
// tool result, in this turn or a later one.
export class PendingWork {
	// Each running work, with the files it writes.
	private readonly running = new Map< Promise< void >, string[] >();
	private readonly reports: string[] = [];

	add( pending: Promise< string | undefined >, files: string[] = [] ): void {
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
		this.running.set( settled, files );
	}

	async settle(): Promise< void > {
		while ( this.running.size > 0 ) {
			await Promise.all( this.running.keys() );
		}
	}

	/** Waits for the work writing a file a call's input names, as a command or a path. */
	async settleFilesIn( input: unknown ): Promise< void > {
		const texts = strings( input );
		await Promise.all(
			[ ...this.running ]
				.filter( ( [ , files ] ) =>
					files.some( ( file ) => texts.some( ( text ) => text.includes( file ) ) )
				)
				.map( ( [ work ] ) => work )
		);
	}

	/** A note to report with the others. */
	tell( note: string ): void {
		this.reports.push( note );
	}

	takeReports(): string | undefined {
		return this.reports.splice( 0 ).join( '\n' ) || undefined;
	}
}

function strings( value: unknown ): string[] {
	if ( typeof value === 'string' ) {
		return [ value ];
	}
	return value && typeof value === 'object' ? Object.values( value ).flatMap( strings ) : [];
}
