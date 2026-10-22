import {
	isAiAccessRequiredError,
	isAiBlockedError,
	isOutOfCreditsError,
	isUsageCapError,
} from '@studio/common/ai/json-events';
import { addAssistantMessageUsage, createTokenUsage } from 'cli/ai/token-usage';
import { inspectDesignTool } from 'cli/ai/tools/inspect-design';
import { takeScreenshotTool } from 'cli/ai/tools/take-screenshot';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { TurnStatus } from '@studio/common/ai/sessions/types';

// Per-turn stats for `studio_code_turn_completed`. Every prop is a count, a
// boolean or a value from a fixed list, so no text from the user, the model, a
// tool or an error can reach Tracks.

const FILE_CHANGE_TOOL_NAMES: ReadonlySet< string > = new Set( [ 'Write', 'Edit' ] );

// Tools that look at the rendered site, so running one after an edit means
// the agent checked its change.
const CHECK_TOOL_NAMES: ReadonlySet< string > = new Set( [
	takeScreenshotTool.name,
	inspectDesignTool.name,
] );

export type TurnErrorKind =
	| 'out_of_credits'
	| 'auth'
	| 'model_unavailable'
	| 'rate_limited'
	| 'network'
	| 'other';

export type TurnSiteKind = 'local' | 'wpcom' | 'none';

export interface TurnStatsProps {
	tool_calls: number;
	tool_errors: number;
	failed_tools: string;
	edits: number;
	checked_after_change?: boolean;
	model_requests: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	error_kind?: TurnErrorKind;
	site_kind: TurnSiteKind;
}

export interface TurnStatsTracker {
	handleEvent( event: AgentSessionEvent ): void;
	getProps( context: {
		outcome: TurnStatus;
		failure?: unknown;
		site?: { remote?: boolean } | null;
	} ): TurnStatsProps;
}

export function getTurnSiteKind( site: { remote?: boolean } | null | undefined ): TurnSiteKind {
	if ( ! site ) {
		return 'none';
	}
	return site.remote ? 'wpcom' : 'local';
}

const NETWORK_ERROR_CODES = new Set( [
	'ECONNREFUSED',
	'ECONNRESET',
	'ENOTFOUND',
	'ETIMEDOUT',
	'EAI_AGAIN',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'EPIPE',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_SOCKET',
] );

function readFailure( failure: unknown ): { message: string; status?: number; code?: string } {
	if ( typeof failure === 'string' ) {
		return { message: failure };
	}
	if ( failure && typeof failure === 'object' ) {
		const record = failure as Record< string, unknown >;
		const cause =
			record.cause && typeof record.cause === 'object'
				? ( record.cause as Record< string, unknown > )
				: undefined;
		const message = [ record.message, cause?.message ]
			.filter( ( part ): part is string => typeof part === 'string' )
			.join( '\n' );
		const status = [ record.status, record.statusCode ].find(
			( value ): value is number => typeof value === 'number'
		);
		const code = [ record.code, cause?.code ].find(
			( value ): value is string => typeof value === 'string'
		);
		return { message, status, code };
	}
	return { message: '' };
}

const MODEL_UNAVAILABLE_PATTERN =
	/\bmodel\b[^\n]*\b(?:not[ _]found|unknown|unsupported|not supported|does not exist|not available|unavailable|invalid)\b|\b(?:unknown|unsupported|invalid)[ _]model\b|\bmodel_not_found\b/i;
const AUTH_PATTERN =
	/\b(?:401|403)\b|unauthori[sz]ed|forbidden|authentication|invalid[ _-](?:x-)?api[ _-]key|api[ _-]key|credentials?\b|not logged in|logged out/i;
const RATE_LIMIT_PATTERN = /\b429\b|rate[ _-]?limit|too many requests/i;
const NETWORK_CODES = [ ...NETWORK_ERROR_CODES ].join( '|' );
const NETWORK_PATTERN = new RegExp(
	`\\b(?:${ NETWORK_CODES })\\b|fetch failed|network|socket hang up|timed? ?out|connection (?:error|refused|reset|closed)`,
	'i'
);

/**
 * Sorts a failed turn into a fixed category. Takes whatever the turn captured
 * (the `agent_end` failure message or the caught error) and never returns any
 * of its text.
 */
export function classifyTurnError( failure: unknown ): TurnErrorKind {
	const { message, status, code } = readFailure( failure );

	// The monthly cost cap is a spending limit too; grouped with the 402.
	if ( isOutOfCreditsError( message ) || isUsageCapError( message ) ) {
		return 'out_of_credits';
	}
	if ( MODEL_UNAVAILABLE_PATTERN.test( message ) ) {
		return 'model_unavailable';
	}
	if (
		status === 401 ||
		status === 403 ||
		isAiBlockedError( message ) ||
		isAiAccessRequiredError( message ) ||
		AUTH_PATTERN.test( message )
	) {
		return 'auth';
	}
	if ( status === 429 || RATE_LIMIT_PATTERN.test( message ) ) {
		return 'rate_limited';
	}
	if ( ( code && NETWORK_ERROR_CODES.has( code ) ) || NETWORK_PATTERN.test( message ) ) {
		return 'network';
	}
	return 'other';
}

/**
 * Accumulates the stats of one turn from its agent events. Events from an
 * attempt that ended with `willRetry` count too: the retry is the same turn.
 */
export function createTurnStatsTracker(): TurnStatsTracker {
	let toolCalls = 0;
	let toolErrors = 0;
	const failedTools = new Set< string >();
	let edits = 0;
	let checkedAfterChange = false;
	let modelRequests = 0;
	const usage = createTokenUsage();

	return {
		handleEvent( event ) {
			if ( event.type === 'message_end' && event.message.role === 'assistant' ) {
				modelRequests += 1;
				addAssistantMessageUsage( usage, event );
				return;
			}
			if ( event.type !== 'tool_execution_end' ) {
				return;
			}
			toolCalls += 1;
			if ( event.isError ) {
				toolErrors += 1;
				failedTools.add( event.toolName );
				return;
			}
			if ( FILE_CHANGE_TOOL_NAMES.has( event.toolName ) ) {
				edits += 1;
				checkedAfterChange = false;
			} else if ( CHECK_TOOL_NAMES.has( event.toolName ) ) {
				checkedAfterChange = true;
			}
		},
		getProps( { outcome, failure, site } ) {
			return {
				tool_calls: toolCalls,
				tool_errors: toolErrors,
				failed_tools: [ ...failedTools ].sort().join( ',' ),
				edits,
				...( edits > 0 ? { checked_after_change: checkedAfterChange } : {} ),
				model_requests: modelRequests,
				input_tokens: usage.input,
				output_tokens: usage.output,
				cache_read_tokens: usage.cacheRead,
				cache_write_tokens: usage.cacheWrite,
				...( outcome === 'error' ? { error_kind: classifyTurnError( failure ) } : {} ),
				site_kind: getTurnSiteKind( site ),
			};
		},
	};
}
