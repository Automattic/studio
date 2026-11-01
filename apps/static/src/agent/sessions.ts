import { summarizeAiSessionEntries } from '@studio/agent/protocol/sessions/summarize-entries';
import { kvGet, kvRange, kvSet, kvUpdate } from '../store';
import type { AiSessionMetadata, AiSessionSummary, LoadedAiSession, SessionEntry } from '../types';
import type {
	StudioCustomEntryDataMap,
	StudioCustomEntryType,
} from '@studio/agent/protocol/sessions/entry-types';

const SESSION_PREFIX = 'agent-session:';

export interface SessionOwner {
	siteId: string;
	sitePath: string;
	siteName: string;
}

// A conversation's own record. Its entries (the same ones the CLI writes to its
// JSONL files, so the UI reads these sessions exactly like desktop ones) are
// stored one per key, so appending one never rewrites the others.
interface SessionRecord {
	id: string;
	createdAt: string;
	metadata: AiSessionMetadata;
	owner?: SessionOwner;
	entryCount: number;
	lastEntryId: string | null;
	// The entries' summary, cleared by each append and refilled by the next list.
	summary?: AiSessionSummary;
}

export interface StoredSession extends SessionRecord {
	entries: SessionEntry[];
}

type NewEntry = Omit< SessionEntry, 'id' | 'parentId' | 'timestamp' >;

function sessionKey( id: string ) {
	return `${ SESSION_PREFIX }${ id }`;
}

function entryPrefix( id: string ) {
	return `agent-entry:${ id }:`;
}

function entryKey( id: string, index: number ) {
	return `${ entryPrefix( id ) }${ String( index ).padStart( 8, '0' ) }`;
}

function shortId(): string {
	return crypto.randomUUID().replace( /-/g, '' ).slice( 0, 8 );
}

export class StaticSessions {
	async list(): Promise< AiSessionSummary[] > {
		const records = await kvRange< SessionRecord >( SESSION_PREFIX );
		const summaries = await Promise.all(
			records.map( async ( record ) => {
				if ( record.summary ) {
					return withPlacement( record.summary, record );
				}
				const summary = await summarizeEntries(
					record,
					await kvRange< SessionEntry >( entryPrefix( record.id ) )
				);
				await kvUpdate< SessionRecord | undefined >(
					sessionKey( record.id ),
					undefined,
					( current ) =>
						current?.entryCount === record.entryCount ? { ...current, summary } : current
				);
				return withPlacement( summary, record );
			} )
		);
		return summaries.sort( ( a, b ) => b.updatedAt.localeCompare( a.updatedAt ) );
	}

	async read( id: string ): Promise< StoredSession | undefined > {
		const record = await kvGet< SessionRecord >( sessionKey( id ) );
		return record && { ...record, entries: await kvRange< SessionEntry >( entryPrefix( id ) ) };
	}

	async load( id: string ): Promise< LoadedAiSession > {
		const session = await this.read( id );
		if ( ! session ) {
			throw new Error( `Session ${ id } not found` );
		}
		return {
			summary: withPlacement( await summarizeEntries( session, session.entries ), session ),
			entries: session.entries,
		};
	}

	async create( owner?: SessionOwner ): Promise< AiSessionSummary > {
		const record: SessionRecord = {
			id: crypto.randomUUID(),
			createdAt: new Date().toISOString(),
			metadata: {},
			owner,
			entryCount: 0,
			lastEntryId: null,
		};
		await kvSet( sessionKey( record.id ), record );
		return withPlacement( await summarizeEntries( record, [] ), record );
	}

	async updateMetadata( id: string, patch: AiSessionMetadata ): Promise< AiSessionSummary > {
		const record = await this.update( id, ( current ) => ( {
			...current,
			metadata: { ...current.metadata, ...patch },
		} ) );
		const summary =
			record.summary ??
			( await summarizeEntries( record, await kvRange< SessionEntry >( entryPrefix( id ) ) ) );
		return withPlacement( summary, record );
	}

	async setOwner( id: string, owner: SessionOwner ) {
		await this.update( id, ( record ) => ( { ...record, owner } ) );
	}

	async append( id: string, entry: NewEntry ) {
		let appended: SessionEntry | undefined;
		await this.update( id, async ( record ) => {
			appended = {
				...entry,
				id: shortId(),
				parentId: record.lastEntryId,
				timestamp: new Date().toISOString(),
			} as SessionEntry;
			await kvSet( entryKey( id, record.entryCount ), appended );
			return {
				...record,
				entryCount: record.entryCount + 1,
				lastEntryId: appended.id,
				summary: undefined,
			};
		} );
		return appended!;
	}

	appendCustom< T extends StudioCustomEntryType >(
		id: string,
		customType: T,
		data: StudioCustomEntryDataMap[ T ]
	) {
		return this.append( id, { type: 'custom', customType, data } as NewEntry );
	}

	private async update(
		id: string,
		update: ( record: SessionRecord ) => SessionRecord | Promise< SessionRecord >
	): Promise< SessionRecord > {
		return kvUpdate< SessionRecord | undefined >( sessionKey( id ), undefined, ( record ) => {
			if ( ! record ) {
				throw new Error( `Session ${ id } not found` );
			}
			return update( record );
		} ) as Promise< SessionRecord >;
	}
}

async function summarizeEntries(
	record: SessionRecord,
	entries: SessionEntry[]
): Promise< AiSessionSummary > {
	const summary = await summarizeAiSessionEntries(
		`session:${ record.id }`,
		[ { type: 'session', id: record.id, timestamp: record.createdAt }, ...entries ],
		async () => record.createdAt
	);
	return summary!;
}

function withPlacement( summary: AiSessionSummary, record: SessionRecord ): AiSessionSummary {
	return {
		...summary,
		...record.metadata,
		ownerSiteId: record.owner?.siteId,
		ownerSitePath: record.owner?.sitePath,
		ownerSiteName: record.owner?.siteName,
	};
}
