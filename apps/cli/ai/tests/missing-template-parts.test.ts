import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { missingTemplateParts } from '@studio/agent/node/missing-template-parts';
import { wpEvalJson } from '@studio/agent/node/tools/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

// A real WordPress install to render the parts with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

const part = ( attributes: object ) =>
	`<!-- wp:template-part ${ JSON.stringify( attributes ) } /-->`;

describe.runIf( WORDPRESS )( 'template parts WordPress renders as nothing', () => {
	let site: HostSite;
	let host: StudioAgentHost;
	const write = ( file: string, content = '' ) => {
		const target = path.join( site.path, 'wp-content/themes', file );
		mkdirSync( path.dirname( target ), { recursive: true } );
		writeFileSync( target, content );
	};
	const remove = ( file: string ) =>
		rmSync( path.join( site.path, 'wp-content/themes', file ), { recursive: true, force: true } );
	const php = ( code: string ) => wpEvalJson( host, site, `${ code }\necho "{}";` );
	// The report on bakery, the active child theme of bakery-parent, after a change.
	const check = async ( change: () => Promise< unknown > ) => {
		const before = await missingTemplateParts.read( site.path, undefined, host );
		await change();
		const after = await missingTemplateParts.read( site.path, before, host );
		const result = await missingTemplateParts.check( site, before, after, host );
		return { ...result, after: result.next ?? after };
	};

	beforeAll( async () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'missing-parts-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root, 'Bakery' );
		host = liveHost( site );
		write( 'bakery-parent/style.css', '/*\nTheme Name: Bakery Parent\n*/' );
		write( 'bakery/style.css', '/*\nTheme Name: Bakery\nTemplate: bakery-parent\n*/' );
		await php(
			'switch_theme( "bakery" ); $updates = new stdClass(); $updates->checked = array( "bakery" => "1.0", "bakery-parent" => "1.0" ); $updates->response = array(); $updates->no_update = array(); set_site_transient( "update_themes", $updates );'
		);
	}, 120000 );
	afterAll( () => site && rmSync( site.path, { recursive: true, force: true } ) );

	it.each< {
		name: string;
		files?: Record< string, string >;
		template?: string;
		saved?: boolean;
		theme?: string;
		reported?: string[];
	} >( [
		{
			name: 'a part written where WordPress reads templates',
			files: { 'bakery/templates/header.html': '' },
			reported: [ 'the template part header', 'templates/header.html is a template' ],
		},
		{
			name: "another theme's part",
			files: { 'bakery/parts/header.html': '' },
			template: part( { slug: 'header', theme: 'twentytwentyfive' } ),
			reported: [ 'header of the theme twentytwentyfive' ],
		},
		{ name: 'a part file of the theme', files: { 'bakery/parts/header.html': '' } },
		{ name: "a part file of the theme's parent", files: { 'bakery-parent/parts/header.html': '' } },
		{ name: 'a part saved to the site', saved: true },
		// WordPress renders the parent's templates with the active child theme,
		// so a part naming the parent renders nothing.
		{
			name: "the parent's template naming the parent",
			theme: 'bakery-parent',
			files: { 'bakery-parent/parts/header.html': '' },
			template: part( { slug: 'header', theme: 'bakery-parent' } ),
			reported: [ 'header of the theme bakery-parent' ],
		},
	] )(
		'$name',
		async ( { files = {}, template, saved, theme = 'bakery', reported } ) => {
			for ( const dir of [ 'templates', 'parts' ] ) {
				remove( `bakery/${ dir }` );
				remove( `bakery-parent/${ dir }` );
			}
			await php(
				'foreach ( get_posts( array( "post_type" => "wp_template_part", "post_status" => "any", "numberposts" => -1 ) ) as $post ) { wp_delete_post( $post->ID, true ); }'
			);
			const { reports } = await check( async () => {
				write( `${ theme }/templates/index.html`, template ?? part( { slug: 'header' } ) );
				for ( const [ file, content ] of Object.entries( files ) ) {
					write( file, content );
				}
				if ( saved ) {
					await php(
						'$id = wp_insert_post( array( "post_type" => "wp_template_part", "post_status" => "publish", "post_name" => "header", "post_title" => "Header" ) ); wp_set_post_terms( $id, "bakery", "wp_theme" );'
					);
				}
			} );
			const report = reports.find( ( { key } ) => key === `missing template parts of ${ theme }` );
			for ( const text of reported ?? [] ) {
				expect( report?.problem ).toContain( text );
				expect( report?.summary ).toContain( text );
			}
			if ( ! reported ) {
				expect( report?.problem ).toBeUndefined();
			}
		},
		60000
	);

	it( 'states the parts newly missing, asks WordPress only on a change, and resolves', async () => {
		remove( 'bakery/parts' );
		const { after: missing } = await check( async () =>
			write( 'bakery/templates/index.html', part( { slug: 'footer' } ) )
		);
		// A call that changes nothing, after which another part goes missing.
		const unchanged = await missingTemplateParts.read( site.path, missing, host );
		expect( await missingTemplateParts.check( site, missing, unchanged, host ) ).toEqual( {
			reports: [],
		} );
		write( 'bakery/templates/page.html', part( { slug: 'sidebar' } ) );
		const [ added ] = (
			await missingTemplateParts.check(
				site,
				unchanged,
				await missingTemplateParts.read( site.path, unchanged, host ),
				host
			)
		).reports;
		expect( added.summary ).toContain( 'the template part sidebar' );
		expect( added.summary ).not.toContain( 'footer' );
		write( 'bakery/parts/footer.html' );
		write( 'bakery/parts/sidebar.html' );
		const { reports } = await missingTemplateParts.check(
			site,
			missing,
			await missingTemplateParts.read( site.path, missing, host ),
			host
		);
		expect( reports ).toEqual( [
			expect.objectContaining( { problem: undefined, summary: undefined } ),
		] );
	}, 60000 );
} );
