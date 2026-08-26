import { Readable, Transform } from 'node:stream';

export const PLAYGROUND_WP_CLI_SHEBANG_PREFIX = '#!/usr/bin/env';

/**
 * When the Playground runtime runs WP-CLI via the `php.cli()` method, it echoes
 * the `#!/usr/bin/env php` shebang line as the first line of stdout. Native PHP
 * doesn't do this. This Transform stream strips out the shebang. Since the
 * shebang is always on the first line, this stream buffers the initial contents
 * until it:
 *
 *  1. Has received a chunk where any byte doesn't match the shebang prefix.
 *  2. Has received bytes that start with the shebang prefix and contain a
 *     newline, in which case it strips the shebang, the newline and everything
 *     in between, and forwards the remainder.
 *
 * Once either case is settled, the stream switches to pass-through mode and
 * forwards all chunks verbatim.
 */
export function stripLeadingShebang( source: Readable ): Readable {
	const prefix = Buffer.from( PLAYGROUND_WP_CLI_SHEBANG_PREFIX );
	// `null` once we've decided what to do and switched to pass-through.
	let buffered: Buffer | null = Buffer.alloc( 0 );

	const transform = new Transform( {
		transform( chunk: Buffer | string, _encoding, callback ) {
			if ( buffered === null ) {
				callback( null, chunk );
				return;
			}

			buffered = Buffer.concat( [ buffered, Buffer.from( chunk ) ] );

			// Compare against as much of the prefix as we've received so far.
			const comparable = Math.min( buffered.length, prefix.length );
			if ( ! buffered.subarray( 0, comparable ).equals( prefix.subarray( 0, comparable ) ) ) {
				// Doesn't start with the shebang — forward everything, stop buffering.
				const passthrough = buffered;
				buffered = null;
				callback( null, passthrough );
				return;
			}

			// Still matching the prefix but haven't confirmed the whole line yet.
			if ( buffered.length < prefix.length ) {
				callback();
				return;
			}

			// No newline yet. Wait for more chunks.
			const newlineIndex = buffered.indexOf( 0x0a /* \n */ );
			if ( newlineIndex === -1 ) {
				callback();
				return;
			}

			// Drop the shebang line including its newline; forward the remainder.
			const remainder = buffered.subarray( newlineIndex + 1 );
			buffered = null;
			callback( null, remainder.length > 0 ? remainder : undefined );
		},
		flush( callback ) {
			// Stream ended while still buffering (e.g. a shebang with no trailing
			// newline, or output shorter than the prefix): forward what we held back.
			const remaining = buffered;
			buffered = null;
			callback( null, remaining && remaining.length > 0 ? remaining : undefined );
		},
	} );

	// `pipe()` doesn't forward source errors, so propagate them to the consumer.
	source.on( 'error', ( error ) => transform.destroy( error ) );
	return source.pipe( transform );
}
