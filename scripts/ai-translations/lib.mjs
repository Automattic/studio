/**
 * AI translations fill the strings GlotPress has no translation for. They live in
 * `packages/common/translations/ai/studio-<locale>.json` and are merged into the shipped
 * `studio-<locale>.jed.json` files, always below the GlotPress translations.
 */

const CONTEXT_SEPARATOR = '\u0004';
const PLACEHOLDER = /%(?:\d+\$)?[-+0#]*\d*(?:\.\d+)?[bcdeEfFgGosuxX%]/g;
const TAG = /<\/?[a-zA-Z][\w-]*\s*\/?>/g;

/**
 * Reads the entries of a .pot file, as written by `wp-babel-makepot`.
 *
 * @param {string} pot
 * @returns {{ key: string, context?: string, singular: string, plural?: string, note?: string, files: string[] }[]}
 */
export function parsePot( pot ) {
	const entries = [];
	for ( const block of pot.split( /\n{2,}/ ) ) {
		const fields = {};
		const notes = [];
		const files = new Set();
		let field;
		for ( const line of block.split( '\n' ) ) {
			const keyword = line.match( /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?) (".*")$/ );
			if ( keyword ) {
				field = keyword[ 1 ];
				fields[ field ] = JSON.parse( keyword[ 2 ] );
			} else if ( line.startsWith( '"' ) && field ) {
				fields[ field ] += JSON.parse( line );
			} else if ( line.startsWith( '#. ' ) ) {
				notes.push( line.slice( 3 ) );
			} else if ( line.startsWith( '#: ' ) ) {
				files.add( line.slice( 3 ).replace( /:\d+$/, '' ) );
			}
		}
		if ( ! fields.msgid ) {
			continue;
		}
		entries.push( {
			key: translationKey( fields.msgid, fields.msgctxt ),
			...( fields.msgctxt && { context: fields.msgctxt } ),
			singular: fields.msgid,
			...( fields.msgid_plural && { plural: fields.msgid_plural } ),
			...( notes.length && { note: notes.join( '\n' ) } ),
			files: [ ...files ],
		} );
	}
	return entries;
}

/**
 * The key of a string in Jed `locale_data.messages`.
 */
export function translationKey( text, context ) {
	return context ? `${ context }${ CONTEXT_SEPARATOR }${ text }` : text;
}

/**
 * @param {Record<string, unknown>} messages Jed `locale_data.messages`
 * @param {string} key
 */
export function isTranslated( messages, key ) {
	const value = messages[ key ];
	return Array.isArray( value ) && value.some( Boolean );
}

/**
 * @param {string} header Jed `plural-forms` header, such as `nplurals=2; plural=n > 1;`
 */
export function pluralCount( header ) {
	return Number( header?.match( /nplurals\s*=\s*(\d+)/ )?.[ 1 ] ?? 2 );
}

/**
 * Removes the merged AI translations from shipped Jed messages, leaving the GlotPress ones.
 */
export function withoutAiTranslations( messages, ai ) {
	return Object.fromEntries(
		Object.entries( messages ).filter( ( [ key, forms ] ) => ! sameForms( forms, ai[ key ] ) )
	);
}

/**
 * Drops the AI translations of strings that left the code or that GlotPress now translates.
 */
export function pruneAiTranslations( ai, entries, glotpress ) {
	const keys = new Set( entries.map( ( entry ) => entry.key ) );
	return Object.fromEntries(
		Object.entries( ai ).filter(
			( [ key ] ) => keys.has( key ) && ! isTranslated( glotpress, key )
		)
	);
}

export function findGaps( entries, messages, ai ) {
	return entries.filter( ( entry ) => ! isTranslated( messages, entry.key ) && ! ai[ entry.key ] );
}

/**
 * Adds the AI translations after the GlotPress messages, without replacing any GlotPress translation.
 * GlotPress's empty entries for untranslated strings are dropped rather than filled in place, so the
 * result is the same whether `glotpress` is a fresh download or a merged file with its AI translations taken out.
 */
export function mergeAiTranslations( glotpress, ai ) {
	const fills = Object.entries( ai ).filter( ( [ key ] ) => ! isTranslated( glotpress, key ) );
	const filled = new Set( fills.map( ( [ key ] ) => key ) );
	return Object.fromEntries( [
		...Object.entries( glotpress ).filter( ( [ key ] ) => ! filled.has( key ) ),
		...fills,
	] );
}

/**
 * Checks that a translation keeps the string's placeholders and markup, so it can't break at runtime.
 *
 * @returns {string | null} Why the translation is invalid, or null.
 */
export function validateTranslation( entry, forms, nplurals ) {
	const expectedCount = entry.plural ? nplurals : 1;
	if ( forms.length !== expectedCount ) {
		return `expected ${ expectedCount } form(s), got ${ forms.length }`;
	}
	if ( forms.some( ( form ) => ! form.trim() ) ) {
		return 'empty translation';
	}
	const english = entry.plural ?? entry.singular;
	for ( const form of forms ) {
		if ( ! sameTokens( tokens( form, TAG ), tokens( english, TAG ) ) ) {
			return `markup must be ${ tokens( english, TAG ).join( ' ' ) || 'absent' }`;
		}
	}
	if ( ! entry.plural ) {
		return sameTokens( tokens( forms[ 0 ], PLACEHOLDER ), tokens( entry.singular, PLACEHOLDER ) )
			? null
			: `placeholders must be ${ tokens( entry.singular, PLACEHOLDER ).join( ' ' ) || 'absent' }`;
	}
	// Plural forms may leave out the count where the language spells it out (`un site`), but every
	// form must stick to the placeholders the English uses, and the last, most general form keeps them all.
	const allowed = [
		...tokens( entry.singular, PLACEHOLDER ),
		...tokens( entry.plural, PLACEHOLDER ),
	];
	for ( const form of forms ) {
		if ( tokens( form, PLACEHOLDER ).some( ( token ) => ! allowed.includes( token ) ) ) {
			return `placeholders must come from ${ allowed.join( ' ' ) || 'none' }`;
		}
	}
	return sameTokens( tokens( forms.at( -1 ), PLACEHOLDER ), tokens( entry.plural, PLACEHOLDER ) )
		? null
		: `the last form must have placeholders ${ tokens( entry.plural, PLACEHOLDER ).join( ' ' ) }`;
}

function tokens( text, pattern ) {
	return ( text.match( pattern ) ?? [] ).map( ( token ) => token.replace( /\s+/g, '' ) ).sort();
}

function sameTokens( a, b ) {
	return a.join( '\n' ) === b.join( '\n' );
}

function sameForms( a, b ) {
	return Array.isArray( a ) && Array.isArray( b ) && a.join( '\n' ) === b.join( '\n' );
}

export function sortKeys( object ) {
	return Object.fromEntries(
		Object.entries( object ).sort( ( [ a ], [ b ] ) => ( a < b ? -1 : a > b ? 1 : 0 ) )
	);
}
