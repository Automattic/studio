import { describe, expect, it } from 'vitest';
import {
	canonicalBlockSlug,
	canonicalCptKey,
	contractFromManifest,
	contractVocabulary,
	deriveThemePrefix,
	findRegisteredPostTypes,
	reconcileBlockJsonName,
	reconcileMarkup,
	validateMarkup,
	type IdentifierContract,
} from 'cli/ai/generation/identifier-contract';

// The canonical contract for the Ember & Oak baseline site that exposed the bug.
const contract: IdentifierContract = {
	prefix: 'ember',
	restNamespace: 'ember/v1',
	blockSlugs: [ 'reservation-form' ],
	blockNames: [ 'ember/reservation-form' ],
	cptKeys: [ 'ember_menu_item', 'ember_reservation' ],
};

describe( 'deriveThemePrefix', () => {
	it( 'takes the first segment of length >= 3', () => {
		expect( deriveThemePrefix( 'ember-oak' ) ).toBe( 'ember' );
		expect( deriveThemePrefix( 'maison-clouet' ) ).toBe( 'maison' );
	} );

	it( 'falls back to "theme" when nothing usable remains', () => {
		expect( deriveThemePrefix( 'a' ) ).toBe( 'theme' );
		expect( deriveThemePrefix( '' ) ).toBe( 'theme' );
	} );

	it( 'caps length at 12 and strips invalid chars', () => {
		expect( deriveThemePrefix( 'Supercalifragilistic Studio' ) ).toBe( 'supercalifra' );
	} );
} );

describe( 'canonicalCptKey', () => {
	it( 'builds {prefix}_{suffix} from a human name', () => {
		expect( canonicalCptKey( 'ember', 'Menu Item' ) ).toBe( 'ember_menu_item' );
		expect( canonicalCptKey( 'ember', 'Reservation' ) ).toBe( 'ember_reservation' );
	} );

	it( 'caps the total key at 20 chars (register_post_type limit)', () => {
		expect( canonicalCptKey( 'ember', 'Press Mention Archive Entry' ).length ).toBeLessThanOrEqual(
			20
		);
	} );

	it( 'does not double the prefix', () => {
		expect( canonicalCptKey( 'ember', 'ember menu item' ) ).toBe( 'ember_menu_item' );
	} );
} );

describe( 'canonicalBlockSlug', () => {
	it( 'strips a redundant theme prefix and slugifies', () => {
		expect( canonicalBlockSlug( 'ember', 'Reservation Form' ) ).toBe( 'reservation-form' );
		expect( canonicalBlockSlug( 'ember', 'Ember Reservation Form' ) ).toBe( 'reservation-form' );
	} );
} );

describe( 'contractFromManifest', () => {
	it( 'derives names, cpt keys, and the REST namespace', () => {
		const built = contractFromManifest( {
			themePrefix: 'ember',
			companionPlugin: {
				blocks: [ { slug: 'reservation-form' } ],
				postTypes: [ { slug: 'ember_menu_item' }, { slug: 'ember_reservation' } ],
			},
		} );
		expect( built.prefix ).toBe( 'ember' );
		expect( built.blockNames ).toEqual( [ 'ember/reservation-form' ] );
		expect( built.cptKeys ).toEqual( [ 'ember_menu_item', 'ember_reservation' ] );
		expect( built.restNamespace ).toBe( 'ember/v1' );
	} );
} );

describe( 'reconcileMarkup', () => {
	it( 'rewrites a drifted block-reference prefix to the canonical one', () => {
		const { html, rewrites } = reconcileMarkup( '<!-- wp:eo/reservation-form /-->', contract );
		expect( html ).toBe( '<!-- wp:ember/reservation-form /-->' );
		expect( rewrites ).toEqual( [
			{ kind: 'block', from: 'eo/reservation-form', to: 'ember/reservation-form' },
		] );
	} );

	it( 'rewrites a drifted query postType via suffix match', () => {
		const { html, rewrites } = reconcileMarkup(
			'<!-- wp:query {"query":{"postType":"eo_menu_item","perPage":3}} -->',
			contract
		);
		expect( html ).toContain( '"postType":"ember_menu_item"' );
		expect( rewrites ).toEqual( [
			{ kind: 'postType', from: 'eo_menu_item', to: 'ember_menu_item' },
		] );
	} );

	it( 'leaves an unresolvable postType and core types untouched', () => {
		const dish = reconcileMarkup( '<!-- wp:query {"query":{"postType":"dish"}} -->', contract );
		expect( dish.html ).toContain( '"postType":"dish"' );
		expect( dish.rewrites ).toEqual( [] );

		const post = reconcileMarkup( '<!-- wp:query {"query":{"postType":"post"}} -->', contract );
		expect( post.rewrites ).toEqual( [] );
	} );
} );

describe( 'validateMarkup', () => {
	it( 'flags an unregistered postType after reconciliation', () => {
		const violations = validateMarkup(
			'<!-- wp:query {"query":{"postType":"dish"}} -->',
			contract,
			'page-home.html'
		);
		expect( violations.map( ( v ) => v.type ) ).toContain( 'unknown_post_type_reference' );
	} );

	it( 'flags an unknown custom-block reference', () => {
		const violations = validateMarkup( '<!-- wp:ember/mystery-widget /-->', contract );
		expect( violations.map( ( v ) => v.type ) ).toContain( 'unknown_block_reference' );
	} );

	it( 'passes clean canonical markup', () => {
		const violations = validateMarkup(
			'<!-- wp:ember/reservation-form /--><!-- wp:query {"query":{"postType":"ember_menu_item"}} --><!-- wp:paragraph -->hi<!-- /wp:paragraph -->',
			contract
		);
		expect( violations ).toEqual( [] );
	} );
} );

describe( 'contractVocabulary', () => {
	it( 'lists the exact block names, cpt keys, and rest namespace for prompts', () => {
		const text = contractVocabulary( {
			themePrefix: 'ember',
			companionPlugin: {
				blocks: [ { slug: 'reservation-form', title: 'Reservation Form', purpose: 'booking' } ],
				postTypes: [ { slug: 'ember_menu_item', name: 'Menu Item' } ],
				restRoutes: [ { path: '/ember/v1/reservations' } ],
			},
		} );
		expect( text ).toContain( 'ember/reservation-form' );
		expect( text ).toContain( 'ember_menu_item' );
		expect( text ).toContain( 'ember/v1' );
	} );
} );

describe( 'findRegisteredPostTypes', () => {
	it( 'extracts register_post_type keys from plugin PHP', () => {
		const php = `<?php
			register_post_type( 'ember_menu_items', array( 'public' => true ) );
			register_post_type("ember_reservations", array());
		`;
		expect( findRegisteredPostTypes( php ).sort() ).toEqual( [
			'ember_menu_items',
			'ember_reservations',
		] );
	} );

	it( 'returns an empty list when there are no literal registrations', () => {
		expect( findRegisteredPostTypes( '<?php // loop-based registration' ) ).toEqual( [] );
	} );
} );

describe( 'reconcileBlockJsonName', () => {
	it( 'forces the block.json name to {prefix}/{slug}', () => {
		const result = reconcileBlockJsonName(
			JSON.stringify( { name: 'ember-oak-functionality/ember-oak-reservation-form', title: 'X' } ),
			'reservation-form',
			contract
		);
		expect( result.changed ).toBe( true );
		expect( JSON.parse( result.json ).name ).toBe( 'ember/reservation-form' );
	} );

	it( 'leaves an already-canonical name unchanged', () => {
		const result = reconcileBlockJsonName(
			JSON.stringify( { name: 'ember/reservation-form' } ),
			'reservation-form',
			contract
		);
		expect( result.changed ).toBe( false );
	} );
} );
