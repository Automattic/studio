import fs from 'fs';
import path from 'path';

/** Studio's notes on earlier calls, by their tool call ID. */
export type CallNotes = Record< string, string >;

// Work tools leave running after they return (see ToolResult.pending), kept
// per chat session so that what it reports reaches the agent with the next
// tool result, in this turn or a later one.
export class PendingWork {
	// Each running work, with the files it writes and the folder they are paths in, when relative.
	private readonly running = new Map< Promise< void >, { files: string[]; folder?: string } >();
	// Each report, with the call it is on when it is a check of one.
	private readonly reports: Array< { text: string; onCall?: string } > = [];

	// `outer`: the work of the session a subagent runs for, whose files its calls wait for too.
	constructor( private readonly outer?: PendingWork ) {}

	add(
		pending: Promise< string | undefined >,
		files: string[] = [],
		folder?: string,
		onCall?: string
	): void {
		const settled: Promise< void > = pending
			.then(
				( report ) => {
					if ( report ) {
						this.reports.push( { text: report, onCall } );
					}
				},
				( error ) => {
					this.reports.push( {
						text: error instanceof Error ? error.message : String( error ),
						onCall,
					} );
				}
			)
			.finally( () => this.running.delete( settled ) );
		this.running.set( settled, { files, folder } );
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
				.filter( ( [ , { files } ] ) =>
					files.some( ( file ) => texts.some( ( text ) => namesFile( text, file ) ) )
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
				.filter( ( [ , { files, folder: filesFolder } ] ) =>
					files
						.map( ( file ) => path.resolve( filesFolder ?? '', file ) )
						.some( ( file ) =>
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
		this.reports.push( { text: note } );
	}

	takeReports(): string | undefined {
		return (
			this.reports
				.splice( 0 )
				.map( ( { text } ) => text )
				.join( '\n' ) || undefined
		);
	}

	/** The reports on calls other than `except`, by call, each once. */
	takeCallNotes( except: string ): CallNotes {
		const notes: CallNotes = {};
		for ( let i = 0; i < this.reports.length;  ) {
			const { text, onCall } = this.reports[ i ];
			if ( onCall && onCall !== except ) {
				notes[ onCall ] = [ notes[ onCall ], text ].filter( Boolean ).join( '\n' );
				this.reports.splice( i, 1 );
			} else {
				i++;
			}
		}
		return notes;
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

// Whether a text names a file as a path, not only in a URL: markup that
// shows an image being generated, as `<img src="http://…/wp-content/uploads/a.jpg">`
// or `/wp-content/uploads/a.jpg`, reads nothing of it.
function namesFile( text: string, file: string ): boolean {
	for ( let at = text.indexOf( file ); at !== -1; at = text.indexOf( file, at + 1 ) ) {
		const token =
			text
				.slice( 0, at )
				.split( /[\s"'(=]/ )
				.pop() ?? '';
		if ( ! /^(https?:)?\/\//.test( token ) && token !== '/' ) {
			return true;
		}
	}
	return false;
}

function strings( value: unknown ): string[] {
	if ( typeof value === 'string' ) {
		return [ value ];
	}
	return value && typeof value === 'object' ? Object.values( value ).flatMap( strings ) : [];
}
