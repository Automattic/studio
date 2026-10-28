import { summarizeAiSessionEntries } from '@studio/agent/protocol/sessions/summarize-entries';
import { kvDelete, kvGet, kvSet, kvUpdate } from '../store';
import type { AiSessionMetadata, AiSessionSummary, LoadedAiSession, SessionEntry } from '../types';
import type {
	StudioCustomEntryDataMap,
	StudioCustomEntryType,
} from '@studio/agent/protocol/sessions/entry-types';

const INDEX_KEY = 'sessions';

export interface SessionOwner {
	siteId: string;
	sitePath: string;
	siteName: string;
}

// One conversation: the same entries the CLI writes to its JSONL files, so the
// UI reads web sessions exactly like desktop ones.
export interface StoredSession {
	id: string;
	createdAt: string;
	entries: SessionEntry[];
	metadata: AiSessionMetadata;
	owner?: SessionOwner;
}

function sessionKey( id: string ) {
	return `session:${ id }`;
}

function shortId(): string {
	return crypto.randomUUID().replace( /-/g, '' ).slice( 0, 8 );
}

export class StaticSessions {
	async list(): Promise< AiSessionSummary[] > {
		const ids = ( await kvGet< string[] >( INDEX_KEY ) ) ?? [];
		const sessions = await Promise.all( ids.map( ( id ) => this.read( id ) ) );
		const summaries = await Promise.all(
			sessions.filter( ( session ): session is StoredSession => !! session ).map( summarize )
		);
		return summaries.sort( ( a, b ) => b.updatedAt.localeCompare( a.updatedAt ) );
	}

	read( id: string ): Promise< StoredSession | undefined > {
		return kvGet< StoredSession >( sessionKey( id ) );
	}

	async load( id: string ): Promise< LoadedAiSession > {
		const session = await this.read( id );
		if ( ! session ) {
			throw new Error( `Session ${ id } not found` );
		}
		return { summary: await summarize( session ), entries: session.entries };
	}

	async create( owner?: SessionOwner ): Promise< AiSessionSummary > {
		const session: StoredSession = {
			id: crypto.randomUUID(),
			createdAt: new Date().toISOString(),
			entries: [],
			metadata: {},
			owner,
		};
		await kvSet( sessionKey( session.id ), session );
		await kvUpdate< string[] >( INDEX_KEY, [], ( ids ) => [ ...ids, session.id ] );
		return summarize( session );
	}

	async update(
		id: string,
		update: ( session: StoredSession ) => StoredSession
	): Promise< StoredSession > {
		return kvUpdate< StoredSession | undefined >( sessionKey( id ), undefined, ( session ) => {
			if ( ! session ) {
				throw new Error( `Session ${ id } not found` );
			}
			return update( session );
		} ) as Promise< StoredSession >;
	}

	async updateMetadata( id: string, patch: AiSessionMetadata ): Promise< AiSessionSummary > {
		return summarize(
			await this.update( id, ( session ) => ( {
				...session,
				metadata: { ...session.metadata, ...patch },
			} ) )
		);
	}

	async setOwner( id: string, owner: SessionOwner ) {
		await this.update( id, ( session ) => ( { ...session, owner } ) );
	}

	async append( id: string, entry: Omit< SessionEntry, 'id' | 'parentId' | 'timestamp' > ) {
		let appended: SessionEntry | undefined;
		await this.update( id, ( session ) => {
			appended = {
				...entry,
				id: shortId(),
				parentId: session.entries.at( -1 )?.id ?? null,
				timestamp: new Date().toISOString(),
			} as SessionEntry;
			return { ...session, entries: [ ...session.entries, appended ] };
		} );
		return appended!;
	}

	appendCustom< T extends StudioCustomEntryType >(
		id: string,
		customType: T,
		data: StudioCustomEntryDataMap[ T ]
	) {
		return this.append( id, { type: 'custom', customType, data } as Omit<
			SessionEntry,
			'id' | 'parentId' | 'timestamp'
		> );
	}

	async delete( id: string ) {
		await kvDelete( sessionKey( id ) );
		await kvUpdate< string[] >( INDEX_KEY, [], ( ids ) => ids.filter( ( other ) => other !== id ) );
	}
}

async function summarize( session: StoredSession ): Promise< AiSessionSummary > {
	const summary = await summarizeAiSessionEntries(
		`session:${ session.id }`,
		[ { type: 'session', id: session.id, timestamp: session.createdAt }, ...session.entries ],
		async () => session.createdAt
	);
	return {
		...summary!,
		...session.metadata,
		ownerSiteId: session.owner?.siteId,
		ownerSitePath: session.owner?.sitePath,
		ownerSiteName: session.owner?.siteName,
	};
}
