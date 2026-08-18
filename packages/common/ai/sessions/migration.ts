// Studio-legacy → pi `SessionEntry` migrator. Pi's own `migrateSessionEntries`
// handles any later pi-internal version bumps from here.

import crypto from 'crypto';
import fs from 'fs/promises';
import { readFirstJsonlLine, splitJsonlContent } from './jsonl';

// Must match pi-coding-agent's `CURRENT_SESSION_VERSION`. If pi bumps it,
// pi's `migrateSessionEntries` will bring our v3 output forward on open.
export const PI_SESSION_VERSION = 3;

// Default `cwd` stamped into session headers when no site directory applies.
export const PI_SESSION_CWD = '~/Studio';

type PiFileEntry = Record< string, unknown > & { type: string };

function makeIdAllocator(): () => string {
	const used = new Set< string >();
	return () => {
		for ( let i = 0; i < 100; i += 1 ) {
			const id = crypto.randomUUID().slice( 0, 8 );
			if ( ! used.has( id ) ) {
				used.add( id );
				return id;
			}
		}
		const fallback = crypto.randomUUID();
		used.add( fallback );
		return fallback;
	};
}

function parseTimestampMs( iso: string | undefined ): number {
	if ( ! iso ) return Date.now();
	const ms = Date.parse( iso );
	return Number.isFinite( ms ) ? ms : Date.now();
}

function toTextContentArray( raw: unknown ): Array< { type: 'text'; text: string } > {
	if ( typeof raw === 'string' ) {
		return raw ? [ { type: 'text', text: raw } ] : [];
	}
	if ( Array.isArray( raw ) ) {
		const out: Array< { type: 'text'; text: string } > = [];
		for ( const block of raw ) {
			if ( block && typeof block === 'object' ) {
				const b = block as { type?: unknown; text?: unknown };
				if ( b.type === 'text' && typeof b.text === 'string' && b.text.length > 0 ) {
					out.push( { type: 'text', text: b.text } );
				}
			}
		}
		return out;
	}
	return [];
}

interface LegacyAssistantContent {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: Record< string, unknown >;
	thinking?: string;
}

interface LegacyToolResult {
	type: 'tool_result';
	tool_use_id: string;
	content: unknown;
	is_error?: boolean;
}

type ToolNameLookup = Map< string, string >;

function normalizeLegacyToolName( name: string ): string {
	return name.startsWith( 'mcp__studio__' ) ? name.slice( 'mcp__studio__'.length ) : name;
}

function buildAssistantMessage(
	model: string,
	timestampMs: number,
	content: LegacyAssistantContent[]
): Record< string, unknown > {
	const out: Array< Record< string, unknown > > = [];
	for ( const block of content ) {
		if ( block.type === 'text' && typeof block.text === 'string' ) {
			out.push( { type: 'text', text: block.text } );
		} else if (
			block.type === 'tool_use' &&
			typeof block.id === 'string' &&
			typeof block.name === 'string'
		) {
			out.push( {
				type: 'toolCall',
				id: block.id,
				name: normalizeLegacyToolName( block.name ),
				arguments: block.input ?? {},
			} );
		} else if ( block.type === 'thinking' && typeof block.thinking === 'string' ) {
			out.push( { type: 'thinking', thinking: block.thinking } );
		}
	}
	return {
		role: 'assistant',
		content: out,
		api: 'anthropic-messages',
		provider: 'anthropic',
		model,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
		timestamp: timestampMs,
	};
}

function buildToolResultMessage(
	timestampMs: number,
	block: LegacyToolResult,
	toolNameLookup: ToolNameLookup
): Record< string, unknown > {
	return {
		role: 'toolResult',
		toolCallId: block.tool_use_id,
		toolName: toolNameLookup.get( block.tool_use_id ) ?? 'unknown',
		content: toTextContentArray( block.content ),
		isError: block.is_error === true,
		timestamp: timestampMs,
	};
}

interface LegacySessionStarted {
	type: 'session.started';
	timestamp: string;
	version: 1;
	sessionId: string;
}

function isLegacyHeader( value: unknown ): value is LegacySessionStarted {
	return (
		!! value &&
		typeof value === 'object' &&
		( value as { type?: unknown } ).type === 'session.started'
	);
}

function isPiHeader( value: unknown ): value is { type: 'session' } {
	return (
		!! value && typeof value === 'object' && ( value as { type?: unknown } ).type === 'session'
	);
}

export type SessionFormat = 'pi' | 'legacy' | 'unknown' | 'empty';

export function detectSessionFormat( firstLine: string | undefined ): SessionFormat {
	if ( ! firstLine ) return 'empty';
	let parsed: unknown;
	try {
		parsed = JSON.parse( firstLine );
	} catch {
		return 'unknown';
	}
	if ( isPiHeader( parsed ) ) return 'pi';
	if ( isLegacyHeader( parsed ) ) return 'legacy';
	return 'unknown';
}

interface LegacyEvent {
	type: string;
	timestamp?: string;
	[ k: string ]: unknown;
}

function parseLegacyLines( content: string ): LegacyEvent[] {
	const events: LegacyEvent[] = [];
	for ( const line of splitJsonlContent( content ) ) {
		const trimmed = line.trim();
		if ( ! trimmed ) continue;
		try {
			const parsed = JSON.parse( trimmed );
			if (
				parsed &&
				typeof parsed === 'object' &&
				typeof ( parsed as LegacyEvent ).type === 'string'
			) {
				events.push( parsed as LegacyEvent );
			}
		} catch {
			// Skip malformed lines.
		}
	}
	return events;
}

// Convert a Studio-legacy event stream into pi `FileEntry[]` at the current
// pi session version. Pure transform — no I/O.
export function migrateLegacyEvents( events: LegacyEvent[], cwd: string ): PiFileEntry[] {
	const nextId = makeIdAllocator();
	const out: PiFileEntry[] = [];
	const toolNameLookup: ToolNameLookup = new Map();
	let parentId: string | null = null;
	let lastModelId: string | undefined;

	const header = events.find( ( e ) => e.type === 'session.started' );
	const sessionId =
		typeof header?.sessionId === 'string' && header.sessionId.length > 0
			? header.sessionId
			: crypto.randomUUID();
	const headerTimestamp =
		typeof header?.timestamp === 'string' ? header.timestamp : new Date().toISOString();

	const sessionHeader: PiFileEntry = {
		type: 'session',
		version: PI_SESSION_VERSION,
		id: sessionId,
		timestamp: headerTimestamp,
		cwd,
	};
	out.push( sessionHeader );

	const append = ( entry: PiFileEntry ): void => {
		out.push( entry );
		const id = entry.id;
		if ( typeof id === 'string' ) parentId = id;
	};

	for ( const event of events ) {
		const ts = event.timestamp ?? headerTimestamp;
		switch ( event.type ) {
			case 'session.started':
				continue;
			case 'session.context': {
				const provider = typeof event.provider === 'string' ? event.provider : '';
				const modelId = typeof event.model === 'string' ? event.model : '';
				if ( modelId && modelId !== lastModelId ) {
					append( {
						type: 'model_change',
						id: nextId(),
						parentId,
						timestamp: ts,
						provider,
						modelId,
					} );
					lastModelId = modelId;
				}
				append( {
					type: 'custom',
					id: nextId(),
					parentId,
					timestamp: ts,
					customType: 'studio.session_context',
					data: { provider, model: modelId },
				} );
				continue;
			}
			case 'session.model_selected': {
				const modelId = typeof event.model === 'string' ? event.model : '';
				if ( modelId && modelId !== lastModelId ) {
					append( {
						type: 'model_change',
						id: nextId(),
						parentId,
						timestamp: ts,
						provider: '',
						modelId,
					} );
					lastModelId = modelId;
				}
				continue;
			}
			case 'session.linked':
				continue;
			case 'session.cleared':
				// Legacy SDK sessions used an in-branch clear marker. Pi sessions
				// model `/clear` as a fresh conversation, so keep only entries
				// after the most recent clear.
				out.splice( 1 );
				parentId = null;
				lastModelId = undefined;
				toolNameLookup.clear();
				continue;
			case 'site.selected':
				append( {
					type: 'custom',
					id: nextId(),
					parentId,
					timestamp: ts,
					customType: 'studio.site_selected',
					data: {
						siteName: typeof event.siteName === 'string' ? event.siteName : '',
						sitePath: typeof event.sitePath === 'string' ? event.sitePath : '',
						remote: event.remote === true,
						url: typeof event.url === 'string' ? event.url : undefined,
						wpcomSiteId: typeof event.wpcomSiteId === 'number' ? event.wpcomSiteId : undefined,
					},
				} );
				continue;
			case 'user.message': {
				const text = typeof event.text === 'string' ? event.text : '';
				const source =
					event.source === 'ask_user' ? ( 'ask_user' as const ) : ( 'prompt' as const );
				const sitePath = typeof event.sitePath === 'string' ? event.sitePath : undefined;
				append( {
					type: 'custom',
					id: nextId(),
					parentId,
					timestamp: ts,
					customType: 'studio.user_prompt',
					data: { text, source, sitePath },
				} );
				if ( source === 'prompt' ) {
					append( {
						type: 'message',
						id: nextId(),
						parentId,
						timestamp: ts,
						message: { role: 'user', content: text, timestamp: parseTimestampMs( ts ) },
					} );
				}
				continue;
			}
			case 'tool.progress':
				append( {
					type: 'custom',
					id: nextId(),
					parentId,
					timestamp: ts,
					customType: 'studio.tool_progress',
					data: { message: typeof event.message === 'string' ? event.message : '' },
				} );
				continue;
			case 'agent.question':
				append( {
					type: 'custom',
					id: nextId(),
					parentId,
					timestamp: ts,
					customType: 'studio.agent_question',
					data: {
						question: typeof event.question === 'string' ? event.question : '',
						options: Array.isArray( event.options ) ? event.options : [],
					},
				} );
				continue;
			case 'turn.closed':
				append( {
					type: 'custom',
					id: nextId(),
					parentId,
					timestamp: ts,
					customType: 'studio.turn_closed',
					data: {
						status:
							event.status === 'error' ||
							event.status === 'max_turns' ||
							event.status === 'interrupted'
								? event.status
								: 'success',
					},
				} );
				continue;
			case 'sdk.message': {
				const message = event.message as
					| {
							type?: string;
							message?: { content?: unknown; model?: string };
					  }
					| undefined;
				if ( ! message || typeof message !== 'object' ) continue;
				const innerModel =
					typeof message.message?.model === 'string' ? message.message.model : lastModelId ?? '';
				if ( message.type === 'assistant' && Array.isArray( message.message?.content ) ) {
					const content = message.message.content as LegacyAssistantContent[];
					for ( const block of content ) {
						if (
							block.type === 'tool_use' &&
							typeof block.id === 'string' &&
							typeof block.name === 'string'
						) {
							toolNameLookup.set( block.id, normalizeLegacyToolName( block.name ) );
						}
					}
					append( {
						type: 'message',
						id: nextId(),
						parentId,
						timestamp: ts,
						message: buildAssistantMessage( innerModel, parseTimestampMs( ts ), content ),
					} );
				} else if ( message.type === 'user' && Array.isArray( message.message?.content ) ) {
					const content = message.message.content as Array< { type?: string } >;
					for ( const raw of content ) {
						if ( raw && typeof raw === 'object' && raw.type === 'tool_result' ) {
							append( {
								type: 'message',
								id: nextId(),
								parentId,
								timestamp: ts,
								message: buildToolResultMessage(
									parseTimestampMs( ts ),
									raw as LegacyToolResult,
									toolNameLookup
								),
							} );
						}
					}
				}
				continue;
			}
			default:
				continue;
		}
	}

	return out;
}

// Migrate the on-disk file in place. Reads the legacy JSONL, transforms,
// and rewrites atomically (`.tmp` + rename). No-ops for already-pi files.
export async function migrateLegacyFileInPlace(
	filePath: string,
	cwd: string = PI_SESSION_CWD
): Promise< void > {
	if ( detectSessionFormat( await readFirstJsonlLine( filePath ) ) !== 'legacy' ) return;

	const content = await fs.readFile( filePath, 'utf8' );
	// The probe above and this read are separate reads, so a concurrent
	// migration can swap the file in between. Every decision from here on is
	// made against this one snapshot, so pi content is never parsed as legacy
	// and rewritten down to a lone header.
	const firstContentLine = splitJsonlContent( content ).find( ( line ) => line.trim() );
	if ( detectSessionFormat( firstContentLine ) !== 'legacy' ) return;

	const events = parseLegacyLines( content );
	if ( ! events.some( ( event ) => event.type === 'session.started' ) ) return;

	const fileEntries = migrateLegacyEvents( events, cwd );

	const serialized = fileEntries.map( ( entry ) => JSON.stringify( entry ) ).join( '\n' ) + '\n';
	// Unique tmp name: concurrent migrations of the same file must not clobber
	// each other's tmp between write and rename.
	const tmp = `${ filePath }.${ crypto.randomUUID().slice( 0, 8 ) }.tmp`;
	try {
		await fs.writeFile( tmp, serialized, 'utf8' );
		await fs.rename( tmp, filePath );
	} catch ( error ) {
		await fs.rm( tmp, { force: true } ).catch( () => undefined );
		throw error;
	}
}

export type { PiFileEntry };
