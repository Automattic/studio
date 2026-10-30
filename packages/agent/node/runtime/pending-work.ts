import fs from 'fs';
import path from 'path';

// Work tools leave running after they return (see ToolResult.pending), kept
// per chat session so that what it reports reaches the agent with the next
// tool result, in this turn or a later one.
export class PendingWork {
	// Each running work, with the files it writes.
	private readonly running = new Map< Promise< void >, string[] >();
	private readonly reports: string[] = [];

	// `outer`: the work of the session a subagent runs for, whose files its calls wait for too.
	constructor( private readonly outer?: PendingWork ) {}

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
		await this.outer?.settleFilesIn( input );
		await Promise.all(
			[ ...this.running ]
				.filter( ( [ , files ] ) =>
					files.some( ( file ) => texts.some( ( text ) => text.includes( file ) ) )
				)
				.map( ( [ work ] ) => work )
		);
	}

	/** Waits for the work writing a file in a folder, as a site's images being generated. */
	async settleFilesUnder( folder: string ): Promise< void > {
		await this.outer?.settleFilesUnder( folder );
		const within = realPath( folder ) + path.sep;
		await Promise.all(
			[ ...this.running ]
				.filter( ( [ , files ] ) =>
					files.some( ( file ) =>
						path
							.join( realPath( path.dirname( file ) ), path.basename( file ) )
							.startsWith( within )
					)
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

// A path however it is named, as /var and /private/var on macOS, through the
// deepest folder of it that exists, as a file still being written has none.
function realPath( file: string ): string {
	const resolved = path.resolve( file );
	try {
		return fs.realpathSync( resolved );
	} catch {
		const parent = path.dirname( resolved );
		return parent === resolved
			? resolved
			: path.join( realPath( parent ), path.basename( resolved ) );
	}
}

function strings( value: unknown ): string[] {
	if ( typeof value === 'string' ) {
		return [ value ];
	}
	return value && typeof value === 'object' ? Object.values( value ).flatMap( strings ) : [];
}
