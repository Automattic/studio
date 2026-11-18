#!/usr/bin/env node

/**
 * AI translations of the strings GlotPress has no translation for yet. See SKILL.md.
 *
 *   merge [--locale=<locale>]                  Merge them into the shipped .jed.json files, after
 *                                              dropping the ones GlotPress now translates.
 *   pending --locale=<locale> [--limit=<n>]    Print the strings still missing, one per line, after a
 *                                              line with the language, plural rule and glossary.
 *   search --locale=<locale> [--limit=<n>] <words…>
 *                                              Print translations whose English has all the words,
 *                                              shortest first.
 *   search --locale=<locale> --exact <strings…>
 *                                              Print the translations of each English string.
 *   add --locale=<locale> <file>               Validate and save translations, then merge them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	findGaps,
	isTranslated,
	mergeAiTranslations,
	parsePot,
	pluralCount,
	pruneAiTranslations,
	sortKeys,
	translationKey,
	validateTranslation,
	withoutAiTranslations,
} from './lib.mjs';

const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..', '..' );
const POT_FILE = path.join( ROOT, 'i18n', 'bundle-strings.pot' );
const TRANSLATIONS_DIR = path.join( ROOT, 'packages', 'common', 'translations' );
const AI_DIR = path.join( TRANSLATIONS_DIR, 'ai' );
const GLOTPRESS_PROJECT_URL = 'https://translate.wordpress.com/projects/studio';

const [ command = 'merge', ...args ] = process.argv.slice( 2 );
const options = Object.fromEntries(
	args.filter( ( arg ) => arg.startsWith( '--' ) ).map( ( arg ) => arg.slice( 2 ).split( '=' ) )
);
const operands = args.filter( ( arg ) => ! arg.startsWith( '--' ) );
const entries = parsePot( fs.readFileSync( POT_FILE, 'utf8' ) );

function locales() {
	const all = fs
		.readdirSync( TRANSLATIONS_DIR )
		.map( ( file ) => file.match( /^studio-(.+)\.jed\.json$/ )?.[ 1 ] )
		.filter( Boolean );
	if ( options.locale && ! all.includes( options.locale ) ) {
		throw new Error( `Unknown locale "${ options.locale }". Locales: ${ all.join( ', ' ) }` );
	}
	return options.locale ? [ options.locale ] : all;
}

function load( locale ) {
	const jedFile = path.join( TRANSLATIONS_DIR, `studio-${ locale }.jed.json` );
	const aiFile = path.join( AI_DIR, `studio-${ locale }.json` );
	const jed = JSON.parse( fs.readFileSync( jedFile, 'utf8' ) );
	const ai = fs.existsSync( aiFile ) ? JSON.parse( fs.readFileSync( aiFile, 'utf8' ) ) : {};
	// The .jed.json file is fresh from GlotPress after a download, and already merged otherwise.
	const glotpress = withoutAiTranslations( jed.locale_data.messages, ai );
	return {
		jedFile,
		aiFile,
		jed,
		glotpress,
		hadAi: Object.keys( ai ).length > 0,
		ai: pruneAiTranslations( ai, entries, glotpress ),
	};
}

function save( { jedFile, aiFile, jed, glotpress, hadAi, ai } ) {
	const sorted = sortKeys( ai );
	jed.locale_data.messages = mergeAiTranslations( glotpress, sorted );
	// Leave a GlotPress file untouched when there is nothing to merge in or take out.
	if ( hadAi || Object.keys( sorted ).length ) {
		fs.writeFileSync( jedFile, JSON.stringify( jed ) );
	}
	if ( Object.keys( sorted ).length ) {
		fs.mkdirSync( AI_DIR, { recursive: true } );
		fs.writeFileSync( aiFile, `${ JSON.stringify( sorted, null, '\t' ) }\n` );
	} else {
		fs.rmSync( aiFile, { force: true } );
	}
	return entries.filter( ( entry ) => ! isTranslated( jed.locale_data.messages, entry.key ) )
		.length;
}

async function glossary( locale ) {
	try {
		const response = await fetch(
			`${ GLOTPRESS_PROJECT_URL }/${ locale }/default/glossary/-export/`
		);
		return response.ok ? ( await response.text() ).trim() : null;
	} catch {
		return null;
	}
}

const commands = {
	merge() {
		for ( const locale of locales() ) {
			const state = load( locale );
			const missing = save( state );
			console.log(
				`${ locale }: ${
					Object.keys( state.ai ).length
				} AI translations, ${ missing } strings left in English`
			);
		}
	},

	async pending() {
		const [ locale ] = locales();
		const { glotpress, ai } = load( locale );
		const gaps = findGaps( entries, glotpress, ai );
		const [ language, region ] = locale.split( '-' );
		console.log(
			JSON.stringify( {
				locale,
				language: new Intl.DisplayNames( [ 'en' ], { type: 'language' } ).of(
					region ? `${ language }-${ region.toUpperCase() }` : language
				),
				pluralForms: glotpress[ '' ]?.[ 'plural-forms' ],
				remaining: gaps.length,
				glossary: await glossary( locale ),
			} )
		);
		for ( const { key, singular, ...entry } of gaps.slice( 0, Number( options.limit ?? 100 ) ) ) {
			console.log( JSON.stringify( { text: singular, ...entry } ) );
		}
	},

	search() {
		const [ locale ] = locales();
		const { glotpress, ai } = load( locale );
		const words = operands.map( ( word ) => word.toLowerCase() );
		const matches = ( key ) =>
			'exact' in options
				? words.includes( key.split( '\u0004' ).pop().toLowerCase() )
				: words.every( ( word ) => key.toLowerCase().includes( word ) );
		const found = [
			...Object.entries( glotpress ).filter( ( [ key ] ) => isTranslated( glotpress, key ) ),
			...Object.entries( ai ).map( ( [ key, forms ] ) => [ key, forms, 'AI' ] ),
		]
			.filter( ( [ key ] ) => key && matches( key ) )
			.sort( ( [ a ], [ b ] ) => a.length - b.length )
			.slice( 0, Number( options.limit ?? 20 ) );
		for ( const [ key, forms, origin ] of found ) {
			console.log(
				JSON.stringify( [ key.replace( '\u0004', ' | ' ), forms, ...( origin ? [ origin ] : [] ) ] )
			);
		}
	},

	add() {
		const [ locale ] = locales();
		const state = load( locale );
		const nplurals = pluralCount( state.glotpress[ '' ]?.[ 'plural-forms' ] );
		// Some strings hold non-breaking spaces, which look like plain spaces once printed.
		const plainSpaces = ( text ) => text.replace( /\u00a0/g, ' ' );
		const byKey = new Map( entries.map( ( entry ) => [ plainSpaces( entry.key ), entry ] ) );
		const rejected = [];
		let added = 0;
		for ( const { text, context, forms } of JSON.parse(
			fs.readFileSync( operands[ 0 ], 'utf8' )
		) ) {
			const entry = byKey.get( plainSpaces( translationKey( text, context ) ) );
			const key = entry?.key;
			const error = ! entry
				? 'no such string: copy `text` and `context` exactly as `pending` printed them'
				: isTranslated( state.glotpress, key )
				? 'GlotPress already translates it'
				: validateTranslation( entry, forms, nplurals );
			if ( error ) {
				rejected.push( { text, ...( context && { context } ), error } );
			} else {
				state.ai[ key ] = forms;
				added++;
			}
		}
		const missing = save( state );
		console.log( JSON.stringify( { added, rejected, stillMissing: missing }, null, '\t' ) );
		process.exitCode = rejected.length ? 1 : 0;
	},
};

if ( ! commands[ command ] ) {
	throw new Error(
		`Unknown command "${ command }". Commands: ${ Object.keys( commands ).join( ', ' ) }`
	);
}
await commands[ command ]();
