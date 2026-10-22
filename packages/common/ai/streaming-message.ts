import { __, _n, sprintf } from '@wordpress/i18n';
import { getToolDisplayName } from './tools';
import type { AssistantMessageDelta } from './json-events';

export interface StreamingTextBlock {
	type: 'text';
	text: string;
}

export interface StreamingThinkingBlock {
	type: 'thinking';
	thinking: string;
}

export interface StreamingToolCallBlock {
	type: 'toolCall';
	id: string;
	name: string;
	// Raw, possibly incomplete JSON as the model has produced it so far. Never
	// treat it as the call's final input: that only arrives with `message_end`.
	argumentsJson: string;
}

export type StreamingBlock = StreamingTextBlock | StreamingThinkingBlock | StreamingToolCallBlock;

/**
 * An assistant message rebuilt from wire deltas. `content` is indexed by the
 * delta's `contentIndex` and can have holes when the stream was joined midway
 * (a reload mid-reply), so the final message's blocks line up with it.
 */
export interface StreamingAssistantMessage {
	content: Array< StreamingBlock | undefined >;
}

function withBlock(
	message: StreamingAssistantMessage,
	index: number,
	block: StreamingBlock
): StreamingAssistantMessage {
	const content = message.content.slice();
	content[ index ] = block;
	return { content };
}

/** Apply one wire delta. Returns the same object when nothing changed. */
export function applyAssistantMessageDelta(
	message: StreamingAssistantMessage,
	delta: AssistantMessageDelta
): StreamingAssistantMessage {
	const index = delta.contentIndex;
	if ( ! Number.isInteger( index ) || index < 0 ) {
		return message;
	}
	const current = message.content[ index ];
	switch ( delta.type ) {
		case 'text_start':
			return current?.type === 'text'
				? message
				: withBlock( message, index, { type: 'text', text: '' } );
		case 'thinking_start':
			return current?.type === 'thinking'
				? message
				: withBlock( message, index, { type: 'thinking', thinking: '' } );
		case 'toolcall_start':
			if ( ! delta.name ) {
				return message;
			}
			return withBlock( message, index, {
				type: 'toolCall',
				id: delta.id,
				name: delta.name,
				argumentsJson: '',
			} );
		case 'text_delta':
			if ( ! delta.delta ) {
				return message;
			}
			return withBlock( message, index, {
				type: 'text',
				text: ( current?.type === 'text' ? current.text : '' ) + delta.delta,
			} );
		case 'thinking_delta':
			if ( ! delta.delta ) {
				return message;
			}
			return withBlock( message, index, {
				type: 'thinking',
				thinking: ( current?.type === 'thinking' ? current.thinking : '' ) + delta.delta,
			} );
		case 'toolcall_delta':
			// Without its `toolcall_start` (joined mid-call) the tool's name is
			// unknown, so there is nothing to show until the message ends.
			if ( current?.type !== 'toolCall' || ! delta.delta ) {
				return message;
			}
			return withBlock( message, index, {
				...current,
				argumentsJson: current.argumentsJson + delta.delta,
			} );
		default:
			return message;
	}
}

type JsonPath = Array< string | number >;

export interface PartialJsonResult {
	value: unknown;
	// Path to the string value still being streamed, if the input ends inside one.
	openStringPath: JsonPath | null;
}

const INCOMPLETE = Symbol( 'incomplete' );

/**
 * Parse JSON that may be cut off anywhere. Values that can't be known yet (a
 * half-written number or literal, an object key without its value) are
 * dropped; a string cut off midway is kept as far as it goes and reported in
 * `openStringPath`, so callers can tell a finished file path from a partial one.
 */
export function parsePartialJson( input: string ): PartialJsonResult {
	let position = 0;
	let openStringPath: JsonPath | null = null;

	const skipWhitespace = () => {
		while ( position < input.length && /\s/.test( input[ position ] ) ) {
			position += 1;
		}
	};

	const parseString = (): { value: string; complete: boolean } => {
		// Caller has checked the opening quote.
		position += 1;
		let value = '';
		while ( position < input.length ) {
			const char = input[ position ];
			if ( char === '"' ) {
				position += 1;
				return { value, complete: true };
			}
			if ( char === '\\' ) {
				const next = input[ position + 1 ];
				if ( next === undefined ) {
					position = input.length;
					break;
				}
				if ( next === 'u' ) {
					const hex = input.slice( position + 2, position + 6 );
					if ( hex.length < 4 ) {
						position = input.length;
						break;
					}
					value += String.fromCharCode( parseInt( hex, 16 ) );
					position += 6;
					continue;
				}
				const escapes: Record< string, string > = {
					n: '\n',
					t: '\t',
					r: '\r',
					b: '\b',
					f: '\f',
				};
				value += escapes[ next ] ?? next;
				position += 2;
				continue;
			}
			value += char;
			position += 1;
		}
		return { value, complete: false };
	};

	const parseValue = ( path: JsonPath ): unknown => {
		skipWhitespace();
		if ( position >= input.length ) {
			return INCOMPLETE;
		}
		const char = input[ position ];
		if ( char === '"' ) {
			const result = parseString();
			if ( ! result.complete ) {
				openStringPath = path;
			}
			return result.value;
		}
		if ( char === '{' ) {
			position += 1;
			const object: Record< string, unknown > = {};
			for (;;) {
				skipWhitespace();
				if ( position >= input.length ) {
					return object;
				}
				if ( input[ position ] === '}' ) {
					position += 1;
					return object;
				}
				if ( input[ position ] === ',' ) {
					position += 1;
					continue;
				}
				if ( input[ position ] !== '"' ) {
					position = input.length;
					return object;
				}
				const key = parseString();
				if ( ! key.complete ) {
					return object;
				}
				skipWhitespace();
				if ( input[ position ] !== ':' ) {
					position = input.length;
					return object;
				}
				position += 1;
				const value = parseValue( [ ...path, key.value ] );
				if ( value === INCOMPLETE ) {
					return object;
				}
				object[ key.value ] = value;
			}
		}
		if ( char === '[' ) {
			position += 1;
			const array: unknown[] = [];
			for (;;) {
				skipWhitespace();
				if ( position >= input.length ) {
					return array;
				}
				if ( input[ position ] === ']' ) {
					position += 1;
					return array;
				}
				if ( input[ position ] === ',' ) {
					position += 1;
					continue;
				}
				const value = parseValue( [ ...path, array.length ] );
				if ( value === INCOMPLETE ) {
					return array;
				}
				array.push( value );
			}
		}
		const match = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(
			input.slice( position )
		);
		if ( ! match ) {
			position = input.length;
			return INCOMPLETE;
		}
		position += match[ 0 ].length;
		// A number at the very end may still be growing.
		if ( position >= input.length && /\d$/.test( match[ 0 ] ) ) {
			return INCOMPLETE;
		}
		return JSON.parse( match[ 0 ] );
	};

	const value = parseValue( [] );
	return { value: value === INCOMPLETE ? undefined : value, openStringPath };
}

function isOpenAt( openPath: JsonPath | null, key: string ): boolean {
	return openPath !== null && openPath.length >= 1 && openPath[ 0 ] === key;
}

function countLines( text: string ): number {
	if ( ! text ) {
		return 0;
	}
	let lines = 1;
	for ( let index = 0; index < text.length; index += 1 ) {
		if ( text.charCodeAt( index ) === 10 ) {
			lines += 1;
		}
	}
	return lines;
}

function basename( filePath: string ): string {
	const parts = filePath.split( /[\\/]/ ).filter( Boolean );
	return parts[ parts.length - 1 ] ?? filePath;
}

export interface StreamingToolCallStatus {
	// e.g. "Writing style.css…"
	label: string;
	// The file the call targets, once its path has fully arrived.
	target?: string;
	// e.g. "340 lines"
	progress?: string;
}

/**
 * Describe a tool call whose arguments are still streaming in. Only the
 * target (a file path) is read from the arguments, and only once it is
 * complete; everything else is a live count, never a half-built value
 * presented as final.
 */
export function getStreamingToolCallStatus(
	block: Pick< StreamingToolCallBlock, 'name' | 'argumentsJson' >
): StreamingToolCallStatus {
	const { value, openStringPath } = parsePartialJson( block.argumentsJson );
	const args = value && typeof value === 'object' ? ( value as Record< string, unknown > ) : {};
	const pathKey = typeof args.path === 'string' ? 'path' : 'file_path';
	const rawPath = args[ pathKey ];
	const target =
		typeof rawPath === 'string' && rawPath && ! isOpenAt( openStringPath, pathKey )
			? rawPath
			: undefined;
	const name = target ? basename( target ) : undefined;
	const lineProgress = ( lines: number ) =>
		lines > 0 ? sprintf( _n( '%d line', '%d lines', lines ), lines ) : undefined;

	switch ( block.name ) {
		case 'Write': {
			const content = typeof args.content === 'string' ? args.content : '';
			return {
				/* translators: %s: file name */
				label: name ? sprintf( __( 'Writing %s…' ), name ) : __( 'Writing file…' ),
				target,
				progress: lineProgress( countLines( content ) ),
			};
		}
		case 'Edit': {
			const edits = Array.isArray( args.edits ) ? args.edits : [];
			const lines = edits.reduce< number >(
				( total, edit ) => {
					const newText = ( edit as { newText?: unknown } | null )?.newText;
					return total + ( typeof newText === 'string' ? countLines( newText ) : 0 );
				},
				typeof args.newText === 'string' ? countLines( args.newText ) : 0
			);
			return {
				/* translators: %s: file name */
				label: name ? sprintf( __( 'Editing %s…' ), name ) : __( 'Editing file…' ),
				target,
				progress: lineProgress( lines ),
			};
		}
		case 'Read':
			return {
				/* translators: %s: file name */
				label: name ? sprintf( __( 'Reading %s…' ), name ) : __( 'Reading file…' ),
				target,
			};
		case 'Bash':
			return { label: __( 'Running command…' ) };
		default:
			return {
				/* translators: %s: tool name, e.g. "Run WordPress command" */
				label: sprintf( __( '%s…' ), getToolDisplayName( block.name ) ),
			};
	}
}
