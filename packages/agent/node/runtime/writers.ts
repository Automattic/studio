import path from 'path';
import { siteIdOfCopy } from '@studio/agent/node/post-copies';
import type { HostSite } from '@studio/agent/node/host';
import type { ChangeReport } from '@studio/agent/node/site-changes';

/** An agent writing to a chat session's sites: the session's own, or a subagent it runs. */
export interface Writer {
	/** A note the agent hears with its next tool result, or as its turn ends. */
	tell( note: string ): void;
}

/**
 * Which running subagent wrote each file, and each post through its copy, so
 * what Studio finds in them reaches that subagent, whichever agent's call the
 * checks ran after. Subagents run at once on the same sites; what none of
 * them wrote is the session's own agent's, as is what one wrote once it ends.
 */
export class Writers {
	private readonly claims = new Map< string, Writer >();

	constructor( readonly main: Writer ) {}

	/** `writer` is about to write `file`. */
	claim( writer: Writer, file: string ): void {
		if ( writer === this.main ) {
			return;
		}
		this.claims.set( path.resolve( file ), writer );
		const post = postOfCopy( file );
		if ( post ) {
			this.claims.set( post, writer );
		}
	}

	/** `writer` ended: what it wrote is the session's own agent's. */
	release( writer: Writer ): void {
		for ( const [ key, claimed ] of this.claims ) {
			if ( claimed === writer ) {
				this.claims.delete( key );
			}
		}
	}

	ofFile( file: string ): Writer {
		return this.claims.get( path.resolve( file ) ) ?? this.main;
	}

	/**
	 * For `SiteChanges.settle()` on `writer`'s call: tells another agent a
	 * report about what it wrote, and says the report went elsewhere.
	 */
	elsewhere( writer: Writer ): ( site: HostSite, report: ChangeReport ) => boolean {
		return ( site, report ) => {
			const owner = this.ofReport( site, report );
			if ( owner === writer ) {
				return false;
			}
			const note = [ report.summary, report.atTurnEnd ? undefined : report.problem ]
				.filter( Boolean )
				.join( '\n' );
			if ( note ) {
				owner.tell( note );
			}
			return true;
		};
	}

	private ofReport( site: HostSite, report: ChangeReport ): Writer {
		const claimed = report.written
			? this.claims.get( path.resolve( report.written ) )
			: report.post !== undefined
			? this.claims.get( `${ site.id } ${ report.post }` )
			: undefined;
		return claimed ?? this.main;
	}
}

// A post's copy is <workspace>/<site id>/<post type>/<ID>.html (see post-copies.ts).
function postOfCopy( file: string ): string | undefined {
	const site = siteIdOfCopy( file );
	const id = /^(\d+)\.html$/.exec( path.basename( file ) )?.[ 1 ];
	return site && id ? `${ site } ${ id }` : undefined;
}
