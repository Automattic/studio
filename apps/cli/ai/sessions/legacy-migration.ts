// One-shot migrator: takes a Studio-legacy `AiSessionEvent[]` JSONL stream
// (the recorder's pre-pi format with `session.started v1`, `sdk.message`,
// `user.message`, etc.) and produces a pi-format `FileEntry[]` at the
// current pi session version, ready for pi.SessionManager.open() to load.

import crypto from 'crypto';
import fs from 'fs/promises';
import { CURRENT_SESSION_VERSION, type FileEntry } from '@mariozechner/pi-coding-agent';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type {
	AssistantMessage,
	TextContent,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
} from '@mariozechner/pi-ai';

interface IdAlloc {
	next(): string;
}

function makeIdAlloc(): IdAlloc {
	const used = new Set< string >();
	return {
		next() {
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
		},
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

interface LegacyAssistantContentText {
	type: 'text';
	text: string;
}
interface LegacyAssistantContentToolUse {
	type: 'tool_use';
	id: string;
	name: string;
	input?: Record< string, unknown >;
}
interface LegacyAssistantContentThinking {
	type: 'thinking';
	thinking?: string;
}
type LegacyAssistantContent =
	| LegacyAssistantContentText
	| LegacyAssistantContentToolUse
	| LegacyAssistantContentThinking
	| { type: string };

interface LegacyToolResult {
	type: 'tool_result';
	tool_use_id: string;
	content: unknown;
	is_error?: boolean;
}

// Keyed lookup: tool_use_id → toolName, populated from earlier
// assistant tool_use blocks. Pi's `ToolResultMessage` requires a toolName,
// so the migrator pairs each result with its prior call.
type ToolNameLookup = Map< string, string >;

function buildAssistantMessage(
	model: string,
	timestampMs: number,
	content: LegacyAssistantContent[]
): AssistantMessage {
	const out: ( TextContent | ThinkingContent | ToolCall )[] = [];
	for ( const block of content ) {
		if (
			block.type === 'text' &&
			typeof ( block as LegacyAssistantContentText ).text === 'string'
		) {
			out.push( { type: 'text', text: ( block as LegacyAssistantContentText ).text } );
		} else if ( block.type === 'tool_use' ) {
			const tu = block as LegacyAssistantContentToolUse;
			out.push( {
				type: 'toolCall',
				id: tu.id,
				name: tu.name,
				arguments: tu.input ?? {},
			} );
		} else if ( block.type === 'thinking' ) {
			const thinkingText = ( block as LegacyAssistantContentThinking ).thinking;
			if ( typeof thinkingText === 'string' ) {
				out.push( { type: 'thinking', thinking: thinkingText } );
			}
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
): ToolResultMessage {
	const text = toTextContentArray( block.content );
	return {
		role: 'toolResult',
		toolCallId: block.tool_use_id,
		toolName: toolNameLookup.get( block.tool_use_id ) ?? 'unknown',
		content: text,
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

export type LegacyDetectionResult =
	| { kind: 'pi' }
	| { kind: 'legacy'; header: LegacySessionStarted }
	| { kind: 'unknown' }
	| { kind: 'empty' };

export function detectFormat( firstLine: string | undefined ): LegacyDetectionResult {
	if ( ! firstLine ) return { kind: 'empty' };
	let parsed: unknown;
	try {
		parsed = JSON.parse( firstLine );
	} catch {
		return { kind: 'unknown' };
	}
	if ( isPiHeader( parsed ) ) return { kind: 'pi' };
	if ( isLegacyHeader( parsed ) ) return { kind: 'legacy', header: parsed };
	return { kind: 'unknown' };
}

interface LegacyEvent {
	type: string;
	timestamp?: string;
	[ k: string ]: unknown;
}

function parseLegacyLines( content: string ): LegacyEvent[] {
	const events: LegacyEvent[] = [];
	for ( const line of content.split( '\n' ) ) {
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

// Convert a Studio-legacy event stream into pi `FileEntry[]` at the
// current pi session version. Mutates nothing — pure transform.
export function migrateLegacyEvents( events: LegacyEvent[] ): FileEntry[] {
	const ids = makeIdAlloc();
	const out: FileEntry[] = [];
	const toolNameLookup: ToolNameLookup = new Map();
	let parentId: string | null = null;
	let lastModelId: string | undefined;

	const header = events.find( ( e ) => e.type === 'session.started' );
	const sessionId =
		typeof header?.sessionId === 'string' && header.sessionId.length > 0
			? ( header.sessionId as string )
			: crypto.randomUUID();
	const headerTimestamp =
		typeof header?.timestamp === 'string'
			? ( header.timestamp as string )
			: new Date().toISOString();

	out.push( {
		type: 'session',
		version: CURRENT_SESSION_VERSION,
		id: sessionId,
		timestamp: headerTimestamp,
		cwd: STUDIO_SITES_ROOT,
	} );

	const append = ( entry: FileEntry ): void => {
		out.push( entry );
		if ( 'id' in entry ) {
			parentId = entry.id;
		}
	};

	for ( const event of events ) {
		const ts = event.timestamp ?? headerTimestamp;
		switch ( event.type ) {
			case 'session.started':
				continue;
			case 'session.context': {
				const provider = typeof event.provider === 'string' ? ( event.provider as string ) : '';
				const modelId = typeof event.model === 'string' ? ( event.model as string ) : '';
				if ( modelId && modelId !== lastModelId ) {
					append( {
						type: 'model_change',
						id: ids.next(),
						parentId,
						timestamp: ts,
						provider,
						modelId,
					} );
					lastModelId = modelId;
				}
				append( {
					type: 'custom',
					id: ids.next(),
					parentId,
					timestamp: ts,
					customType: 'studio.session_context',
					data: { provider, model: modelId },
				} );
				continue;
			}
			case 'session.model_selected': {
				const modelId = typeof event.model === 'string' ? ( event.model as string ) : '';
				if ( modelId && modelId !== lastModelId ) {
					append( {
						type: 'model_change',
						id: ids.next(),
						parentId,
						timestamp: ts,
						provider: '',
						modelId,
					} );
					lastModelId = modelId;
				}
				continue;
			}
			case 'session.linked': {
				const agentSessionId =
					typeof event.agentSessionId === 'string' ? ( event.agentSessionId as string ) : '';
				append( {
					type: 'custom',
					id: ids.next(),
					parentId,
					timestamp: ts,
					customType: 'studio.session_linked',
					data: { agentSessionId },
				} );
				continue;
			}
			case 'session.cleared':
				append( {
					type: 'custom',
					id: ids.next(),
					parentId,
					timestamp: ts,
					customType: 'studio.session_cleared',
					data: {},
				} );
				continue;
			case 'site.selected':
				append( {
					type: 'custom',
					id: ids.next(),
					parentId,
					timestamp: ts,
					customType: 'studio.site_selected',
					data: {
						siteName: typeof event.siteName === 'string' ? event.siteName : '',
						sitePath: typeof event.sitePath === 'string' ? event.sitePath : '',
						remote: event.remote === true,
						url: typeof event.url === 'string' ? event.url : undefined,
						wpcomSiteId:
							typeof event.wpcomSiteId === 'number' ? ( event.wpcomSiteId as number ) : undefined,
					},
				} );
				continue;
			case 'user.message': {
				const text = typeof event.text === 'string' ? ( event.text as string ) : '';
				const source =
					event.source === 'ask_user' ? ( 'ask_user' as const ) : ( 'prompt' as const );
				const sitePath =
					typeof event.sitePath === 'string' ? ( event.sitePath as string ) : undefined;

				// Marker entry so the renderer can distinguish ask_user answers
				// from real prompts even when they look the same to the model.
				append( {
					type: 'custom',
					id: ids.next(),
					parentId,
					timestamp: ts,
					customType: 'studio.user_prompt',
					data: { text, source, sitePath },
				} );

				if ( source === 'prompt' ) {
					append( {
						type: 'message',
						id: ids.next(),
						parentId,
						timestamp: ts,
						message: {
							role: 'user',
							content: text,
							timestamp: parseTimestampMs( ts ),
						},
					} );
				}
				continue;
			}
			case 'tool.progress':
				append( {
					type: 'custom',
					id: ids.next(),
					parentId,
					timestamp: ts,
					customType: 'studio.tool_progress',
					data: { message: typeof event.message === 'string' ? event.message : '' },
				} );
				continue;
			case 'agent.question':
				append( {
					type: 'custom',
					id: ids.next(),
					parentId,
					timestamp: ts,
					customType: 'studio.agent_question',
					data: {
						question: typeof event.question === 'string' ? event.question : '',
						options: Array.isArray( event.options )
							? ( event.options as Array< { label: string; description: string } > )
							: [],
					},
				} );
				continue;
			case 'turn.closed':
				append( {
					type: 'custom',
					id: ids.next(),
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
							typeof ( block as LegacyAssistantContentToolUse ).id === 'string' &&
							typeof ( block as LegacyAssistantContentToolUse ).name === 'string'
						) {
							const tu = block as LegacyAssistantContentToolUse;
							toolNameLookup.set( tu.id, tu.name );
						}
					}
					append( {
						type: 'message',
						id: ids.next(),
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
								id: ids.next(),
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

// Migrate the on-disk file in place. Reads the legacy JSONL, transforms, and
// rewrites atomically. Safe to call after format detection — no-ops for
// already-pi files.
export async function migrateLegacyFileInPlace( filePath: string ): Promise< void > {
	const content = await fs.readFile( filePath, 'utf8' );
	const firstLine = content.split( '\n' ).find( ( line ) => line.trim().length > 0 );
	const detection = detectFormat( firstLine );
	if ( detection.kind !== 'legacy' ) return;

	const events = parseLegacyLines( content );
	const fileEntries = migrateLegacyEvents( events );

	const serialized = fileEntries.map( ( entry ) => JSON.stringify( entry ) ).join( '\n' ) + '\n';
	const tmp = `${ filePath }.tmp`;
	await fs.writeFile( tmp, serialized, 'utf8' );
	await fs.rename( tmp, filePath );
}
