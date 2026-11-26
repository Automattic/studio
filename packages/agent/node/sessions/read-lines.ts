import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

// Yields a file's non-empty lines one at a time, so a session file full of
// screenshots is never held in memory whole.
export async function* readNonEmptyLines( filePath: string ): AsyncGenerator< string > {
	const input = createReadStream( filePath, 'utf8' );
	try {
		for await ( const line of createInterface( { input, crlfDelay: Infinity } ) ) {
			const trimmed = line.trim();
			if ( trimmed ) yield trimmed;
		}
	} finally {
		input.destroy();
	}
}
