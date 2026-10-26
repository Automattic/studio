import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { blockStyleClasses } from 'cli/ai/block-style-classes';
import { runWpCli } from 'cli/ai/tools/utils';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );

// A real WordPress install to register block styles with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const group = ( className: string ) =>
	`<!-- wp:group {"className":"${ className }"} --><div class="wp-block-group ${ className }"></div><!-- /wp:group -->`;

// As run 36's 01a177ff-c3a6 did: a block style registered in PHP, and markup built there too.
const plugin = ( markup: string ) => `<?php
add_action( 'init', function () {
	register_block_style( 'core/group', array( 'name' => 'er-card', 'label' => 'Card' ) );
	register_block_pattern( 'ember/cards', array( 'title' => 'Cards', 'content' => ${ JSON.stringify(
		markup
	) } ) );
} );
`;

describe.runIf( WORDPRESS )( 'blocks that carry a registered block style by bare name', () => {
	let site: SiteData;
	const check = async ( markup: string ) => {
		const dir = path.join( site.path, 'wp-content/mu-plugins' );
		mkdirSync( dir, { recursive: true } );
		writeFileSync( path.join( dir, 'ember.php' ), plugin( markup ) );
		const { reports } = await blockStyleClasses.check( site, { code: 'a' }, { code: 'b' } );
		return reports[ 0 ];
	};
	beforeAll( () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'block-style-classes-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = { id: 'site', name: 'Ember Roasters', path: root } as SiteData;
	} );
	afterAll( () => rmSync( site.path, { recursive: true, force: true } ) );

	it( 'names the blocks, their type, the style and where they are', async () => {
		const report = await check(
			group( 'er-card' ) + group( 'er-card' ) + group( 'is-style-er-card er-card' )
		);
		expect( report.atTurnEnd ).toBe( true );
		expect( report.problem ).toContain(
			'Ember Roasters: the site registers block styles that its blocks carry by bare name: 2 core/group block(s) with the class "er-card" and not "is-style-er-card" (in pattern ember/cards).'
		);
		expect( report.problem ).toContain( 'wp-includes/block-supports/block-style-variations.php' );
	}, 60000 );

	it( "reads posts' content too", async () => {
		const id = (
			await runWpCli( site, [
				'eval',
				`echo wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Home', 'post_content' => ${ JSON.stringify(
					`<!-- wp:columns --><div class="wp-block-columns">${ group(
						'er-card'
					) }</div><!-- /wp:columns -->`
				) } ) );`,
			] )
		).trim();
		const report = await check( '' );
		expect( report.problem ).toContain(
			`1 core/group block(s) with the class "er-card" and not "is-style-er-card" (in page ${ id })`
		);
		await runWpCli( site, [ 'post', 'delete', id, '--force' ] );
	}, 60000 );

	it.each( [
		{ name: 'blocks that apply the style', markup: group( 'is-style-er-card' ) },
		{
			name: 'a block of a type the style is not registered for',
			markup:
				'<!-- wp:paragraph {"className":"er-card"} --><p class="er-card">Hi</p><!-- /wp:paragraph -->',
		},
	] )(
		'raises nothing for $name',
		async ( { markup } ) => {
			expect( ( await check( markup ) ).problem ).toBeUndefined();
		},
		60000
	);

	it( 'asks WordPress only when the code or content changed', async () => {
		const versions = { code: 'a', content: 'b' };
		expect( await blockStyleClasses.check( site, versions, { ...versions } ) ).toEqual( {
			reports: [],
		} );
	} );
} );
