import type { QuestionAsked } from 'cli/remote-session/turn-runner';

const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ANSI_ESCAPE_PATTERN = new RegExp( String.fromCharCode( 0x1b ) + '\\[[0-9;?]*[A-Za-z]', 'g' );

export interface ExtractReplyInput {
	replyText?: string;
	questions?: QuestionAsked[];
	isError?: boolean;
}

/**
 * Produce the text to post to Telegram from a turn's captured state.
 * Returns null when there is no reply to post (caller should post the
 * "Local agent did not return a result" fallback).
 */
export function extractReply( input: ExtractReplyInput ): string | null {
	const stripped = input.replyText ? stripAnsi( input.replyText ).trim() : '';
	const hasQuestions = input.questions && input.questions.length > 0;

	if ( ! hasQuestions ) {
		if ( ! stripped ) {
			return null;
		}
		return input.isError ? `⚠️ ${ stripped }` : stripped;
	}

	const formattedQuestions = formatQuestions( input.questions! );
	if ( stripped ) {
		return `${ stripped }\n\n${ formattedQuestions }`;
	}
	return formattedQuestions;
}

function formatQuestions( questions: QuestionAsked[] ): string {
	if ( questions.length === 1 ) {
		return formatSingleQuestion( questions[ 0 ] );
	}
	return questions
		.map( ( q, idx ) => `${ idx + 1 }. ${ formatSingleQuestion( q ) }` )
		.join( '\n\n' );
}

function formatSingleQuestion( q: QuestionAsked ): string {
	const header = `**${ q.question.trim() }**`;
	const lines = q.options.map( ( option, idx ) => {
		const letter = OPTION_LETTERS[ idx ] ?? String( idx + 1 );
		const label = option.label.trim();
		const description = option.description?.trim() ?? '';
		if ( description && description !== label ) {
			return `- ${ letter }) ${ label } — ${ description }`;
		}
		return `- ${ letter }) ${ label }`;
	} );
	lines.push( '- _Or reply with anything else for "Other"._' );
	return `${ header }\n\n${ lines.join( '\n' ) }`;
}

function stripAnsi( input: string ): string {
	return input.replace( ANSI_ESCAPE_PATTERN, '' );
}

/**
 * Split a Markdown reply into Telegram-safe chunks, preserving fenced code blocks.
 * Code fences (```…```) are never split mid-block; a single over-size fenced block
 * is split into `(part N/M)` labeled blocks using the same language tag.
 */
export function chunkReply( text: string, maxChars: number ): string[] {
	if ( text.length <= maxChars ) {
		return [ text ];
	}

	const segments = splitPreservingFences( text );
	const chunks: string[] = [];
	let current = '';

	const flush = () => {
		if ( current ) {
			chunks.push( current );
			current = '';
		}
	};

	for ( const segment of segments ) {
		// Segment is either a full fenced block or plain text between fences.
		if ( segment.isCode ) {
			if ( segment.text.length > maxChars ) {
				flush();
				chunks.push( ...splitLongCodeBlock( segment.text, maxChars ) );
				continue;
			}
			if ( current.length + ( current ? 2 : 0 ) + segment.text.length > maxChars ) {
				flush();
			}
			current = current ? `${ current }\n\n${ segment.text }` : segment.text;
			continue;
		}

		// Plain text — split on paragraph/sentence boundaries, then hard-wrap if needed.
		const pieces = splitPlainText( segment.text, maxChars );
		for ( const piece of pieces ) {
			if ( ! piece ) {
				continue;
			}
			if ( current.length + ( current ? 2 : 0 ) + piece.length > maxChars ) {
				flush();
			}
			current = current ? `${ current }\n\n${ piece }` : piece;
		}
	}

	flush();
	return chunks.length > 0 ? chunks : [ text.slice( 0, maxChars ) ];
}

interface Segment {
	text: string;
	isCode: boolean;
}

function splitPreservingFences( input: string ): Segment[] {
	const segments: Segment[] = [];
	const fencePattern = /```[^\n]*\n[\s\S]*?```/g;
	let cursor = 0;
	let match: RegExpExecArray | null;
	while ( ( match = fencePattern.exec( input ) ) !== null ) {
		if ( match.index > cursor ) {
			segments.push( { text: input.slice( cursor, match.index ), isCode: false } );
		}
		segments.push( { text: match[ 0 ], isCode: true } );
		cursor = match.index + match[ 0 ].length;
	}
	if ( cursor < input.length ) {
		segments.push( { text: input.slice( cursor ), isCode: false } );
	}
	return segments;
}

function splitLongCodeBlock( block: string, maxChars: number ): string[] {
	const firstNewline = block.indexOf( '\n' );
	const header = firstNewline === -1 ? '```' : block.slice( 0, firstNewline ).trim();
	const body = block.replace( /^```[^\n]*\n?/, '' ).replace( /\n?```\s*$/, '' );
	// Budget for fence wrappers + label header. Estimate generously.
	const overhead = header.length + 20; // "```\n\n(part X/Y)\n"
	const inner = Math.max( 1, maxChars - overhead );

	const lines = body.split( '\n' );
	const slices: string[] = [];
	let buf = '';
	for ( const line of lines ) {
		if ( buf.length + line.length + 1 > inner ) {
			if ( buf ) {
				slices.push( buf );
				buf = '';
			}
			if ( line.length > inner ) {
				// One line is longer than a chunk; hard-wrap that line too.
				for ( let i = 0; i < line.length; i += inner ) {
					slices.push( line.slice( i, i + inner ) );
				}
				continue;
			}
		}
		buf = buf ? `${ buf }\n${ line }` : line;
	}
	if ( buf ) {
		slices.push( buf );
	}
	const total = slices.length;
	return slices.map( ( slice, idx ) => {
		const label = `(part ${ idx + 1 }/${ total })`;
		return `${ header }\n${ label }\n${ slice }\n\`\`\``;
	} );
}

function splitPlainText( input: string, maxChars: number ): string[] {
	if ( input.length <= maxChars ) {
		return [ input ];
	}
	// Paragraph level first.
	const paragraphs = input.split( /\n\n+/ );
	const results: string[] = [];
	for ( const para of paragraphs ) {
		if ( para.length <= maxChars ) {
			results.push( para );
			continue;
		}
		// Sentence-level split.
		const sentences = para.split( /(?<=[.!?])\s+/ );
		let buf = '';
		for ( const sentence of sentences ) {
			if ( sentence.length > maxChars ) {
				if ( buf ) {
					results.push( buf );
					buf = '';
				}
				// Hard wrap a runaway sentence.
				for ( let i = 0; i < sentence.length; i += maxChars ) {
					results.push( sentence.slice( i, i + maxChars ) );
				}
				continue;
			}
			if ( buf.length + sentence.length + 1 > maxChars ) {
				results.push( buf );
				buf = sentence;
			} else {
				buf = buf ? `${ buf } ${ sentence }` : sentence;
			}
		}
		if ( buf ) {
			results.push( buf );
		}
	}
	return results;
}
