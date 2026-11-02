/**
 * JSON written as text, as the text it replaces read: each value that did not
 * change keeps its text as written, with its own spacing and line breaks, and
 * only a changed value is written anew, at its depth. A file Studio changes
 * after a write then reads as written everywhere it did not change.
 */

type Node =
	| { kind: 'value'; start: number; end: number }
	| { kind: 'array'; start: number; end: number; items: Node[] }
	| {
			kind: 'object';
			start: number;
			end: number;
			members: { key: string; value: Node }[];
	  };

// The span of each value in JSON text, by a parse that follows JSON.parse.
function parse( text: string ): Node {
	let at = 0;
	const space = () => {
		while ( /\s/.test( text[ at ] ?? '' ) ) {
			at++;
		}
	};
	const string = () => {
		const start = at++;
		while ( text[ at ] !== '"' ) {
			at += text[ at ] === '\\' ? 2 : 1;
		}
		at++;
		return JSON.parse( text.slice( start, at ) ) as string;
	};
	const value = (): Node => {
		space();
		const start = at;
		if ( text[ at ] === '{' ) {
			at++;
			const members: { key: string; value: Node }[] = [];
			space();
			while ( text[ at ] !== '}' ) {
				space();
				const key = string();
				space();
				at++; // :
				members.push( { key, value: value() } );
				space();
				if ( text[ at ] === ',' ) {
					at++;
				}
				space();
			}
			return { kind: 'object', start, end: ++at, members };
		}
		if ( text[ at ] === '[' ) {
			at++;
			const items: Node[] = [];
			space();
			while ( text[ at ] !== ']' ) {
				items.push( value() );
				space();
				if ( text[ at ] === ',' ) {
					at++;
				}
				space();
			}
			return { kind: 'array', start, end: ++at, items };
		}
		if ( text[ at ] === '"' ) {
			string();
		} else {
			while ( at < text.length && ! /[\s,\]}]/.test( text[ at ] ) ) {
				at++;
			}
		}
		return { kind: 'value', start, end: at };
	};
	return value();
}

const same = ( a: unknown, b: unknown ) => JSON.stringify( a ) === JSON.stringify( b );

/** `value` as JSON text, keeping the text `text` gives each value that is unchanged. */
export function rewriteJson( text: string, value: unknown ): string {
	let old: unknown;
	let root: Node;
	try {
		old = JSON.parse( text );
		root = parse( text );
	} catch {
		return `${ JSON.stringify( value, null, '\t' ) }\n`;
	}
	const unit = text.match( /\n([ \t]+)\S/ )?.[ 1 ] ?? '\t';
	const fresh = ( next: unknown, depth: number ) =>
		JSON.stringify( next, null, unit ).replace( /\n/g, `\n${ unit.repeat( depth ) }` );

	// The text of `next`, where `node` spans the value it replaces in `text`.
	const write = ( next: unknown, was: unknown, node: Node, depth: number ): string => {
		const written = text.slice( node.start, node.end );
		if ( same( next, was ) ) {
			return written;
		}
		if (
			node.kind === 'object' &&
			next &&
			typeof next === 'object' &&
			! Array.isArray( next ) &&
			was &&
			typeof was === 'object'
		) {
			const keys = Object.keys( next );
			const kept = node.members.map( ( { key } ) => key );
			// A member removed or moved is written anew, with the whole object.
			if ( ! same( keys.slice( 0, kept.length ), kept ) ) {
				return fresh( next, depth );
			}
			let out = '';
			let from = node.start;
			node.members.forEach( ( member ) => {
				out += text.slice( from, member.value.start );
				out += write(
					( next as Record< string, unknown > )[ member.key ],
					( was as Record< string, unknown > )[ member.key ],
					member.value,
					depth + 1
				);
				from = member.value.end;
			} );
			const added = keys.slice( kept.length );
			if ( ! added.length ) {
				return out + text.slice( from, node.end );
			}
			if ( ! kept.length || ! written.includes( '\n' ) ) {
				return fresh( next, depth );
			}
			const inner = unit.repeat( depth + 1 );
			const entries = added.map(
				( key ) =>
					`${ inner }${ JSON.stringify( key ) }: ${ fresh(
						( next as Record< string, unknown > )[ key ],
						depth + 1
					) }`
			);
			return `${ out },\n${ entries.join( ',\n' ) }\n${ unit.repeat( depth ) }}`;
		}
		if (
			node.kind === 'array' &&
			Array.isArray( next ) &&
			Array.isArray( was ) &&
			next.length >= node.items.length &&
			node.items.length
		) {
			let out = '';
			let from = node.start;
			node.items.forEach( ( item, index ) => {
				out += text.slice( from, item.start );
				out += write( next[ index ], was[ index ], item, depth + 1 );
				from = item.end;
			} );
			const added = next.slice( node.items.length );
			if ( ! added.length ) {
				return out + text.slice( from, node.end );
			}
			if ( ! written.includes( '\n' ) ) {
				return fresh( next, depth );
			}
			const inner = unit.repeat( depth + 1 );
			return `${ out },\n${ added
				.map( ( item ) => `${ inner }${ fresh( item, depth + 1 ) }` )
				.join( ',\n' ) }\n${ unit.repeat( depth ) }]`;
		}
		return fresh( next, depth );
	};

	return (
		text.slice( 0, root.start ) +
		write( value, old, root, 0 ) +
		( text.slice( root.end ).trim() ? '\n' : text.slice( root.end ) || '\n' )
	);
}
