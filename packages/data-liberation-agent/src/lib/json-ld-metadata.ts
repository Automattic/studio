import * as cheerio from 'cheerio';

export const SOURCE_JSON_LD_SCHEMA = 'data-liberation/source-json-ld/v1';

const MAX_JSON_LD_SCRIPTS = 16;
const MAX_JSON_LD_SCRIPT_BYTES = 64 * 1024;
const MAX_JSON_LD_TOTAL_BYTES = 256 * 1024;
const MAX_JSON_LD_DIAGNOSTICS = 16;

export interface SourceJsonLdDiagnostic {
	code: 'invalid_json' | 'invalid_shape' | 'oversize' | 'limit_reached';
	script_index: number;
	bytes: number;
}

export interface SourceJsonLdDocument {
	source_url: string;
	aliases: {
		canonical?: string;
		open_graph?: string;
	};
	objects: unknown[];
	diagnostics: SourceJsonLdDiagnostic[];
}

function resolvedUrl( value: string | undefined, sourceUrl: string ): string | undefined {
	if ( ! value ) return undefined;
	try {
		return new URL( value, sourceUrl ).href;
	} catch {
		return undefined;
	}
}

/**
 * Captures inert JSON-LD as parsed data before HTML sanitization removes scripts.
 * Limits apply per document so source metadata cannot dominate an artifact.
 */
export function capturedJsonLd( html: string, sourceUrl: string ): SourceJsonLdDocument | undefined {
	const $ = cheerio.load( html );
	const aliases = {
		canonical: resolvedUrl( $( 'link[rel="canonical"]' ).first().attr( 'href' ), sourceUrl ),
		open_graph: resolvedUrl( $( 'meta[property="og:url"]' ).first().attr( 'content' ), sourceUrl ),
	};
	const objects: unknown[] = [];
	const diagnostics: SourceJsonLdDiagnostic[] = [];
	let totalBytes = 0;
	const scripts = $( 'script[type]' ).toArray().filter( ( script ) =>
		/^application\/ld\+json(?:\s*;|\s*$)/i.test( $( script ).attr( 'type' ) ?? '' )
	);

	for ( const [ scriptIndex, script ] of scripts.entries() ) {
		const source = $( script ).text();
		const bytes = Buffer.byteLength( source );
		const diagnostic = ( code: SourceJsonLdDiagnostic[ 'code' ] ) => {
			if ( diagnostics.length < MAX_JSON_LD_DIAGNOSTICS ) {
				diagnostics.push( { code, script_index: scriptIndex, bytes } );
			}
		};
		if ( scriptIndex >= MAX_JSON_LD_SCRIPTS || totalBytes + bytes > MAX_JSON_LD_TOTAL_BYTES ) {
			diagnostic( 'limit_reached' );
			continue;
		}
		if ( bytes > MAX_JSON_LD_SCRIPT_BYTES ) {
			diagnostic( 'oversize' );
			continue;
		}
		totalBytes += bytes;
		try {
			const value: unknown = JSON.parse( source );
			if ( value === null || typeof value !== 'object' ) {
				diagnostic( 'invalid_shape' );
				continue;
			}
			objects.push( value );
		} catch {
			diagnostic( 'invalid_json' );
		}
	}

	return objects.length > 0 || diagnostics.length > 0
		? { source_url: sourceUrl, aliases, objects, diagnostics }
		: undefined;
}
