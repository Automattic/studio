// Translates a pi-format session JSONL (header + `SessionEntry[]`) back into
// the legacy `AiSessionEvent[]` shape so the renderer's existing
// summary/filter/conversation code keeps working without changes. Disk is
// pi format; `AiSessionEvent` is just the in-memory abstraction.
//
// All Studio-specific entries land via the `studio.*` `customType` namespace
// — any unknown pi entry types are silently dropped from the legacy view.

import crypto from 'crypto';
import type { PiFileEntry } from './migration';
import type { AiSessionEvent } from './types';

// Loose typing for pi entries (we accept any Record-like JSON object, narrow
// at each branch).
interface PiEntry {
	type?: unknown;
	id?: unknown;
	parentId?: unknown;
	timestamp?: unknown;
	customType?: unknown;
	data?: unknown;
	message?: unknown;
	provider?: unknown;
	modelId?: unknown;
	[ k: string ]: unknown;
}

interface PiHeader {
	type: 'session';
	id: string;
	timestamp: string;
	[ k: string ]: unknown;
}

function isPiHeader( value: unknown ): value is PiHeader {
	return (
		!! value &&
		typeof value === 'object' &&
		( value as { type?: unknown } ).type === 'session' &&
		typeof ( value as { id?: unknown } ).id === 'string' &&
		typeof ( value as { timestamp?: unknown } ).timestamp === 'string'
	);
}

function asString( v: unknown ): string {
	return typeof v === 'string' ? v : '';
}

interface PiTextOrImageBlock {
	type?: string;
	text?: string;
}

function piContentToLegacyContent(
	content: unknown
): Array< { type: string; text?: string } > | string {
	if ( typeof content === 'string' ) return content;
	if ( ! Array.isArray( content ) ) return [];
	const out: Array< { type: string; text?: string } > = [];
	for ( const block of content as PiTextOrImageBlock[] ) {
		if ( block && typeof block === 'object' ) {
			if ( block.type === 'text' && typeof block.text === 'string' ) {
				out.push( { type: 'text', text: block.text } );
			}
		}
	}
	return out;
}

interface AssistantBlock {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	arguments?: Record< string, unknown >;
}

function piAssistantContentToSdkContent( content: unknown ): Array< {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: Record< string, unknown >;
} > {
	if ( ! Array.isArray( content ) ) return [];
	const out: Array< {
		type: string;
		text?: string;
		id?: string;
		name?: string;
		input?: Record< string, unknown >;
	} > = [];
	for ( const block of content as AssistantBlock[] ) {
		if ( ! block || typeof block !== 'object' ) continue;
		if ( block.type === 'text' && typeof block.text === 'string' ) {
			out.push( { type: 'text', text: block.text } );
		} else if (
			block.type === 'toolCall' &&
			typeof block.id === 'string' &&
			typeof block.name === 'string'
		) {
			out.push( {
				type: 'tool_use',
				id: block.id,
				name: block.name,
				input: ( block.arguments as Record< string, unknown > ) ?? {},
			} );
		}
	}
	return out;
}

// Convert a parsed pi-format JSONL stream (header line + entries) into the
// legacy `AiSessionEvent[]` view. Order is preserved.
export function piEntriesToLegacyEvents( fileEntries: PiEntry[] ): AiSessionEvent[] {
	const out: AiSessionEvent[] = [];
	const header = fileEntries.find( isPiHeader );
	const baseTimestamp = header?.timestamp ?? new Date().toISOString();
	const sessionId = header?.id ?? '';

	if ( header ) {
		out.push( {
			type: 'session.started',
			timestamp: header.timestamp,
			version: 1,
			sessionId: header.id,
		} );
	}

	for ( const entry of fileEntries ) {
		if ( isPiHeader( entry ) ) continue;
		const ts = asString( entry.timestamp ) || baseTimestamp;

		if ( entry.type === 'custom' && typeof entry.customType === 'string' ) {
			const data = ( entry.data ?? {} ) as Record< string, unknown >;
			switch ( entry.customType ) {
				case 'studio.session_context':
					out.push( {
						type: 'session.context',
						timestamp: ts,
						provider: asString( data.provider ),
						model: asString( data.model ),
					} );
					continue;
				case 'studio.session_linked':
					out.push( {
						type: 'session.linked',
						timestamp: ts,
						agentSessionId: asString( data.agentSessionId ),
					} );
					continue;
				case 'studio.session_cleared':
					out.push( { type: 'session.cleared', timestamp: ts } );
					continue;
				case 'studio.site_selected':
					out.push( {
						type: 'site.selected',
						timestamp: ts,
						siteName: asString( data.siteName ),
						sitePath: asString( data.sitePath ),
						remote: data.remote === true,
						url: typeof data.url === 'string' ? data.url : undefined,
						wpcomSiteId: typeof data.wpcomSiteId === 'number' ? data.wpcomSiteId : undefined,
					} );
					continue;
				case 'studio.user_prompt':
					out.push( {
						type: 'user.message',
						timestamp: ts,
						text: asString( data.text ),
						source: data.source === 'ask_user' ? 'ask_user' : 'prompt',
						sitePath: typeof data.sitePath === 'string' ? data.sitePath : undefined,
					} );
					continue;
				case 'studio.tool_progress':
					out.push( {
						type: 'tool.progress',
						timestamp: ts,
						message: asString( data.message ),
					} );
					continue;
				case 'studio.agent_question':
					out.push( {
						type: 'agent.question',
						timestamp: ts,
						question: asString( data.question ),
						options: Array.isArray( data.options )
							? ( data.options as Array< { label: string; description: string } > )
							: [],
					} );
					continue;
				case 'studio.turn_closed': {
					const status = data.status;
					out.push( {
						type: 'turn.closed',
						timestamp: ts,
						status:
							status === 'error' || status === 'max_turns' || status === 'interrupted'
								? status
								: 'success',
					} );
					continue;
				}
				default:
					continue;
			}
		}

		if ( entry.type === 'model_change' ) {
			// Surface as a `session.model_selected` so resume-context resolution
			// (in apps/cli/ai/sessions/context.ts via legacy events) can pick up
			// user-driven model overrides written by `setAiSessionModel`.
			const modelId = asString( entry.modelId );
			if ( modelId ) {
				out.push( { type: 'session.model_selected', timestamp: ts, model: modelId } );
			}
			continue;
		}

		if ( entry.type === 'message' && entry.message && typeof entry.message === 'object' ) {
			const msg = entry.message as {
				role?: string;
				content?: unknown;
				toolCallId?: string;
				model?: string;
				isError?: boolean;
				stopReason?: string;
				errorMessage?: string;
			};
			if ( msg.role === 'assistant' ) {
				out.push( {
					type: 'sdk.message',
					timestamp: ts,
					message: {
						type: 'assistant',
						parent_tool_use_id: null,
						uuid: asString( entry.id ),
						session_id: sessionId,
						message: {
							id: asString( entry.id ),
							type: 'message',
							role: 'assistant',
							model: asString( msg.model ),
							content: piAssistantContentToSdkContent( msg.content ),
							stop_reason: msg.stopReason ?? null,
							stop_sequence: null,
							usage: {
								input_tokens: 0,
								output_tokens: 0,
								cache_creation_input_tokens: 0,
								cache_read_input_tokens: 0,
								service_tier: 'standard',
							},
						},
						error: msg.stopReason === 'error' ? msg.errorMessage ?? 'unknown' : undefined,
					},
				} as AiSessionEvent );
			} else if ( msg.role === 'toolResult' ) {
				const resultContent = piContentToLegacyContent( msg.content );
				out.push( {
					type: 'sdk.message',
					timestamp: ts,
					message: {
						type: 'user',
						parent_tool_use_id: msg.toolCallId ?? null,
						uuid: asString( entry.id ),
						session_id: sessionId,
						message: {
							role: 'user',
							content: [
								{
									type: 'tool_result',
									tool_use_id: msg.toolCallId ?? '',
									content: resultContent,
									is_error: msg.isError === true,
								},
							],
						},
					},
				} as AiSessionEvent );
			}
			// `user` role messages are already represented by the matching
			// `studio.user_prompt` custom entry above; skip to avoid duplicates.
			continue;
		}
	}

	return out;
}

function shortId(): string {
	return crypto.randomUUID().slice( 0, 8 );
}

// Translate a legacy `AiSessionEvent` into a pi `FileEntry` (or several).
// Used by `appendAiSessionEvent` when the on-disk file is already pi format.
// `parentId` should be the id of the last entry in the existing file so the
// pi tree-structure invariant holds.
//
// Returns an empty array for legacy event types that don't map cleanly
// (e.g. `session.started`, which is already represented by the file header).
export function legacyEventToPiEntries(
	event: AiSessionEvent,
	parentId: string | null
): PiFileEntry[] {
	const ts = event.timestamp ?? new Date().toISOString();
	switch ( event.type ) {
		case 'session.started':
			return [];
		case 'session.context':
			return [
				{
					type: 'custom',
					id: shortId(),
					parentId,
					timestamp: ts,
					customType: 'studio.session_context',
					data: { provider: event.provider, model: event.model },
				},
			];
		case 'session.linked':
			return [
				{
					type: 'custom',
					id: shortId(),
					parentId,
					timestamp: ts,
					customType: 'studio.session_linked',
					data: { agentSessionId: event.agentSessionId },
				},
			];
		case 'session.model_selected':
			return [
				{
					type: 'model_change',
					id: shortId(),
					parentId,
					timestamp: ts,
					provider: '',
					modelId: event.model,
				},
			];
		case 'session.cleared':
			return [
				{
					type: 'custom',
					id: shortId(),
					parentId,
					timestamp: ts,
					customType: 'studio.session_cleared',
					data: {},
				},
			];
		case 'site.selected':
			return [
				{
					type: 'custom',
					id: shortId(),
					parentId,
					timestamp: ts,
					customType: 'studio.site_selected',
					data: {
						siteName: event.siteName,
						sitePath: event.sitePath,
						remote: event.remote,
						url: event.url,
						wpcomSiteId: event.wpcomSiteId,
					},
				},
			];
		case 'user.message': {
			const userPromptId = shortId();
			const userPromptEntry: PiFileEntry = {
				type: 'custom',
				id: userPromptId,
				parentId,
				timestamp: ts,
				customType: 'studio.user_prompt',
				data: { text: event.text, source: event.source, sitePath: event.sitePath },
			};
			if ( event.source === 'prompt' ) {
				return [
					userPromptEntry,
					{
						type: 'message',
						id: shortId(),
						parentId: userPromptId,
						timestamp: ts,
						message: {
							role: 'user',
							content: event.text,
							timestamp: Date.parse( ts ) || Date.now(),
						},
					},
				];
			}
			return [ userPromptEntry ];
		}
		case 'tool.progress':
			return [
				{
					type: 'custom',
					id: shortId(),
					parentId,
					timestamp: ts,
					customType: 'studio.tool_progress',
					data: { message: event.message },
				},
			];
		case 'agent.question':
			return [
				{
					type: 'custom',
					id: shortId(),
					parentId,
					timestamp: ts,
					customType: 'studio.agent_question',
					data: { question: event.question, options: event.options },
				},
			];
		case 'turn.closed':
			return [
				{
					type: 'custom',
					id: shortId(),
					parentId,
					timestamp: ts,
					customType: 'studio.turn_closed',
					data: { status: event.status },
				},
			];
		case 'sdk.message':
			// Live-runtime SDK messages aren't appended through this path —
			// the pi runtime persists them via SessionManager directly.
			return [];
		default:
			return [];
	}
}
