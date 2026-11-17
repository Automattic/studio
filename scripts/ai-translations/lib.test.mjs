import { describe, expect, it } from 'vitest';
import {
	findGaps,
	mergeAiTranslations,
	parsePot,
	pruneAiTranslations,
	validateTranslation,
	withoutAiTranslations,
} from './lib.mjs';

const POT = `# THIS IS A GENERATED FILE. DO NOT EDIT DIRECTLY.

msgid ""
msgstr "Content-Type: text/plain; charset=utf-8\\n"

#: apps/ui/src/a.tsx:1
#. %s: site name
msgid "Delete %s?"
msgstr ""

#: apps/ui/src/b.tsx:2
msgctxt "hosting provider name"
msgid "Pressable"
msgstr ""

#: apps/ui/src/c.tsx:3
msgid "%d site"
msgid_plural "%d sites"
msgstr[0] ""

#: apps/cli/d.ts:4
msgid ""
"Line one\\n"
"line \\"two\\""
msgstr ""

# THIS IS THE END OF THE GENERATED FILE.`;

describe( 'parsePot', () => {
	it( 'reads contexts, plurals, notes and multi-line strings', () => {
		expect( parsePot( POT ) ).toEqual( [
			{
				key: 'Delete %s?',
				singular: 'Delete %s?',
				note: '%s: site name',
				files: [ 'apps/ui/src/a.tsx' ],
			},
			{
				key: 'hosting provider name\u0004Pressable',
				context: 'hosting provider name',
				singular: 'Pressable',
				files: [ 'apps/ui/src/b.tsx' ],
			},
			{ key: '%d site', singular: '%d site', plural: '%d sites', files: [ 'apps/ui/src/c.tsx' ] },
			{ key: 'Line one\nline "two"', singular: 'Line one\nline "two"', files: [ 'apps/cli/d.ts' ] },
		] );
	} );
} );

describe( 'validateTranslation', () => {
	const entry = { key: 'k', singular: 'Move %1$s to <a>%2$s</a>' };

	it( 'accepts a translation that keeps placeholders and markup, in any order', () => {
		expect( validateTranslation( entry, [ 'Déplacer vers <a>%2$s</a> : %1$s' ], 2 ) ).toBeNull();
	} );

	it( 'rejects missing placeholders, changed markup or extra forms', () => {
		expect( validateTranslation( entry, [ 'Déplacer %1$s vers <a>ici</a>' ], 2 ) ).toMatch(
			/placeholders/
		);
		expect( validateTranslation( entry, [ 'Déplacer %1$s vers <b>%2$s</b>' ], 2 ) ).toMatch(
			/markup/
		);
		expect( validateTranslation( entry, [ 'a %1$s <a>%2$s</a>', 'b' ], 2 ) ).toMatch( /form/ );
	} );

	it( 'lets plural forms spell out the count, but not the most general form', () => {
		const plural = { key: '%d site', singular: '%d site', plural: '%d sites' };
		expect( validateTranslation( plural, [ 'un site', '%d sites' ], 2 ) ).toBeNull();
		expect( validateTranslation( plural, [ '%d site', 'des sites' ], 2 ) ).toMatch( /last form/ );
		expect( validateTranslation( plural, [ '%d сайт', '%d сайта' ], 3 ) ).toMatch( /3 form/ );
	} );
} );

describe( 'merging with GlotPress', () => {
	const entries = parsePot( POT );

	it( 'fills only the strings GlotPress does not translate', () => {
		const glotpress = { '%d site': [ '' ], 'Delete %s?': [ 'Supprimer %s ?' ] };
		const ai = pruneAiTranslations(
			{
				'Delete %s?': [ 'Effacer %s ?' ],
				'%d site': [ '%d site', '%d sites' ],
				'Removed string': [ 'Chaîne supprimée' ],
			},
			entries,
			glotpress
		);

		expect( ai ).toEqual( { '%d site': [ '%d site', '%d sites' ] } );
		const merged = mergeAiTranslations( glotpress, ai );
		expect( merged[ 'Delete %s?' ] ).toEqual( [ 'Supprimer %s ?' ] );
		expect( merged[ '%d site' ] ).toEqual( [ '%d site', '%d sites' ] );
		expect( findGaps( entries, merged, ai ).map( ( entry ) => entry.singular ) ).toEqual( [
			'Pressable',
			'Line one\nline "two"',
		] );
		const glotpressOnly = withoutAiTranslations( merged, ai );
		expect( glotpressOnly ).toEqual( { 'Delete %s?': [ 'Supprimer %s ?' ] } );
		// Merging again gives the same file, key order included.
		expect( JSON.stringify( mergeAiTranslations( glotpressOnly, ai ) ) ).toBe(
			JSON.stringify( merged )
		);
	} );
} );
