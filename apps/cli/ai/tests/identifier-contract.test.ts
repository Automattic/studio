import { describe, expect, it } from 'vitest';
import {
	canonicalBlockSlug,
	canonicalCptKey,
	contractFromManifest,
	contractVocabulary,
	deriveThemePrefix,
	findRegisteredPostTypes,
	findRegisteredTaxonomies,
	reconcileBlockJsonName,
	reconcileMarkup,
	sanitizeCptArchiveSlugs,
	validateMarkup,
	type IdentifierContract,
} from 'cli/ai/tools/site-generator/identifier-contract';

// The canonical contract for the Ember & Oak baseline site that exposed the bug.
const contract: IdentifierContract = {
	prefix: 'ember',
	restNamespace: 'ember/v1',
	blockSlugs: [ 'reservation-form' ],
	blockNames: [ 'ember/reservation-form' ],
	cptKeys: [ 'ember_menu_item', 'ember_reservation' ],
	pageSlugs: [ 'menu', 'reservations', 'home' ],
	taxKeys: [],
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
			pages: [ { slug: 'menu' }, { slug: 'reservations' } ],
			companionPlugin: {
				blocks: [ { slug: 'reservation-form' } ],
				postTypes: [ { slug: 'ember_menu_item' }, { slug: 'ember_reservation' } ],
			},
		} );
		expect( built.prefix ).toBe( 'ember' );
		expect( built.blockNames ).toEqual( [ 'ember/reservation-form' ] );
		expect( built.cptKeys ).toEqual( [ 'ember_menu_item', 'ember_reservation' ] );
		expect( built.restNamespace ).toBe( 'ember/v1' );
		expect( built.pageSlugs ).toEqual( [ 'menu', 'reservations' ] );
		expect( built.taxKeys ).toEqual( [] );
	} );

	it( 'tolerates a manifest without pages', () => {
		const built = contractFromManifest( {
			themePrefix: 'ember',
			companionPlugin: { blocks: [], postTypes: [] },
		} );
		expect( built.pageSlugs ).toEqual( [] );
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

describe( 'sanitizeCptArchiveSlugs', () => {
	it( 'rewrites a has_archive slug that collides with a page to true', () => {
		const php = `<?php register_post_type( 'ember_special', array( 'public' => true, 'has_archive' => 'menu', 'show_in_rest' => true ) );`;
		const { php: out, violations } = sanitizeCptArchiveSlugs( php, [ 'menu', 'home' ] );
		expect( out ).toContain( "'has_archive' => true" );
		expect( out ).not.toContain( "'has_archive' => 'menu'" );
		expect( out ).toContain( "'public' => true" );
		expect( out ).toContain( "'show_in_rest' => true" );
		expect( violations.map( ( v ) => v.type ) ).toContain( 'cpt_archive_slug_collides_with_page' );
		expect( violations.map( ( v ) => v.ref ) ).toContain( 'menu' );
	} );

	it( 'rewrites a colliding rewrite slug to the default (true), dropping the pretty slug', () => {
		const php = `<?php register_post_type( 'ember_special', array( 'public' => true, 'has_archive' => true, 'rewrite' => array( 'slug' => 'menu', 'with_front' => false ) ) );`;
		const { php: out, violations } = sanitizeCptArchiveSlugs( php, [ 'menu' ] );
		expect( out ).toContain( "'rewrite' => true" );
		expect( out ).not.toContain( "'slug' => 'menu'" );
		expect( violations.map( ( v ) => v.type ) ).toContain( 'cpt_archive_slug_collides_with_page' );
	} );

	it( 'leaves a prefixed/non-colliding registration untouched', () => {
		const php = `<?php register_post_type( 'ember_special', array( 'public' => true, 'has_archive' => true, 'show_in_rest' => true ) );`;
		const { php: out, violations } = sanitizeCptArchiveSlugs( php, [ 'menu', 'home' ] );
		expect( out ).toBe( php );
		expect( violations ).toEqual( [] );
	} );

	it( 'leaves a non-colliding string has_archive slug untouched', () => {
		const php = `<?php register_post_type( 'ember_press', array( 'has_archive' => 'press-coverage' ) );`;
		const { php: out } = sanitizeCptArchiveSlugs( php, [ 'menu', 'home' ] );
		expect( out ).toBe( php );
	} );

	it( 'is idempotent', () => {
		const php = `<?php register_post_type( 'ember_special', array( 'has_archive' => 'menu', 'rewrite' => array( 'slug' => 'menu' ) ) );`;
		const once = sanitizeCptArchiveSlugs( php, [ 'menu' ] ).php;
		const twice = sanitizeCptArchiveSlugs( once, [ 'menu' ] ).php;
		expect( twice ).toBe( once );
		expect( once ).not.toContain( "'menu'" );
	} );
} );

describe( 'taxonomy reconciliation and validation', () => {
	it( 'strips an unknown (unregistered) taxQuery so the loop falls back to postType only', () => {
		const markup =
			'<!-- wp:query {"query":{"postType":"ember_menu_item","perPage":6,"taxQuery":{"ember_cuisine":[{"slug":"italian"}]}}} -->';
		const { html, rewrites } = reconcileMarkup( markup, contract );
		expect( html ).not.toContain( 'ember_cuisine' );
		expect( html ).not.toContain( 'taxQuery' );
		expect( html ).toContain( '"postType":"ember_menu_item"' );
		expect( html ).toContain( '"perPage":6' );
		expect( rewrites ).toContainEqual( { kind: 'taxonomy', from: 'ember_cuisine', to: '' } );
	} );

	it( 'preserves a taxQuery against a declared taxonomy', () => {
		const withTax: IdentifierContract = { ...contract, taxKeys: [ 'ember_cuisine' ] };
		const markup =
			'<!-- wp:query {"query":{"postType":"ember_menu_item","taxQuery":{"ember_cuisine":[5]}}} -->';
		const { html } = reconcileMarkup( markup, withTax );
		expect( html ).toContain( 'ember_cuisine' );
	} );

	it( 'preserves a core taxonomy (category) taxQuery', () => {
		const markup = '<!-- wp:query {"query":{"postType":"post","taxQuery":{"category":[3]}}} -->';
		const { html } = reconcileMarkup( markup, contract );
		expect( html ).toContain( 'category' );
	} );

	it( 'flags an unknown taxonomy reference in validateMarkup', () => {
		const violations = validateMarkup(
			'<!-- wp:query {"query":{"postType":"ember_menu_item","taxQuery":{"ember_cuisine":[1]}}} -->',
			contract,
			'page-menu.html'
		);
		expect( violations.map( ( v ) => v.type ) ).toContain( 'unknown_taxonomy_reference' );
		expect( violations.map( ( v ) => v.ref ) ).toContain( 'ember_cuisine' );
	} );

	it( 'does not flag a core taxonomy', () => {
		const violations = validateMarkup(
			'<!-- wp:query {"query":{"postType":"post","taxQuery":{"post_tag":[2]}}} -->',
			contract
		);
		expect( violations.map( ( v ) => v.type ) ).not.toContain( 'unknown_taxonomy_reference' );
	} );
} );

describe( 'findRegisteredTaxonomies', () => {
	it( 'extracts register_taxonomy keys from plugin PHP', () => {
		const php = `<?php
			register_taxonomy( 'ember_cuisine', array( 'ember_menu_item' ), array() );
			register_taxonomy("ember_region", 'ember_menu_item', array());
		`;
		expect( findRegisteredTaxonomies( php ).sort() ).toEqual( [ 'ember_cuisine', 'ember_region' ] );
	} );

	it( 'returns an empty list when there are no registrations', () => {
		expect( findRegisteredTaxonomies( '<?php // none' ) ).toEqual( [] );
	} );
} );
