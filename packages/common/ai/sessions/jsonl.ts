// Shared JSONL line handling for session files. Every session reader must
// split lines the same way, or a file can show up in listings yet load
// differently (or not at all) when opened.

import { createReadStream } from 'fs';

// A single session entry should never come close to this. Longer lines are
// skipped as malformed instead of buffered, so a corrupted newline-free file
// cannot balloon memory or hit V8's string cap — which surfaces as an
// uncatchable RangeError inside stream callbacks.
export const MAX_JSONL_LINE_LENGTH = 64 * 1024 * 1024;

const LINE_BREAK = /\r\n|\n|\r/;

// Split in-memory JSONL content on the same line breaks as `readJsonlLines`.
export function splitJsonlContent( content: string ): string[] {
	return content.split( LINE_BREAK );
}

// Stream trimmed, non-empty lines from a JSONL file without holding the whole
// file — or any oversized line — in memory.
export async function* readJsonlLines(
	filePath: string,
	{ maxLineLength = MAX_JSONL_LINE_LENGTH }: { maxLineLength?: number } = {}
): AsyncGenerator< string > {
	const stream = createReadStream( filePath, { encoding: 'utf8' } );
	let carry = '';
	let skippingOversizedLine = false;

	for await ( const chunk of stream ) {
		carry += chunk as string;

		const parts = carry.split( LINE_BREAK );
		carry = parts.pop() ?? '';

		for ( const part of parts ) {
			if ( skippingOversizedLine ) {
				// This break ends the oversized line; discard its tail.
				skippingOversizedLine = false;
				continue;
			}
			if ( part.length > maxLineLength ) continue;
			const trimmed = part.trim();
			if ( trimmed ) yield trimmed;
		}

		if ( ! skippingOversizedLine && carry.length > maxLineLength ) {
			skippingOversizedLine = true;
		}
		if ( skippingOversizedLine ) {
			carry = '';
		}
	}

	if ( ! skippingOversizedLine ) {
		const trimmed = carry.trim();
		if ( trimmed ) yield trimmed;
	}
}

// First non-empty line of a JSONL file, without reading past it.
export async function readFirstJsonlLine( filePath: string ): Promise< string | undefined > {
	for await ( const line of readJsonlLines( filePath ) ) {
		return line;
	}
	return undefined;
}
