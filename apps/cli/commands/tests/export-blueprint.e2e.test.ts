/** @vitest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openBlueprint } from '@studio/blueprints/node';
import { extractZip } from '@studio/common/lib/extract-zip';
import { afterEach, describe, expect, it } from 'vitest';
import {
	cleanupCliEnv,
	cliE2ePrerequisitesMet,
	runCli,
	setupCliEnv,
	type CliEnv,
} from '../site/tests/helpers/cli-e2e';

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'Blueprint recipe export', () => {
	let env: CliEnv | undefined;
	afterEach( async () => {
		if ( ! env ) return;
		await runCli( [ 'site', 'stop', '--all' ], env );
		cleanupCliEnv( env );
	}, 60_000 );

	it.each( [ false, true ] )(
		'recreates a designed site without exporting its database (source running: %s)',
		{ tags: [ 'e2e' ], timeout: 240_000 },
		async ( running ) => {
			env = setupCliEnv( { ownServerFiles: true } );
			const phpBin = path.join( env.configDir, 'php-bin' );
			fs.unlinkSync( phpBin );
			fs.cpSync( path.join( os.homedir(), '.studio/php-bin' ), phpBin, {
				recursive: true,
				mode: fs.constants.COPYFILE_FICLONE,
			} );
			const wordpressVersions = path.join( env.configDir, 'server-files/wordpress-versions' );
			fs.mkdirSync( wordpressVersions, { recursive: true } );
			const wordpress = path.join( os.homedir(), '.studio/server-files/wordpress-versions/latest' );
			fs.symlinkSync( wordpress, path.join( wordpressVersions, 'latest' ), 'junction' );
			const source = path.join( env.sitesDir, 'source' );
			const target = path.join( env.sitesDir, 'target' );
			const bundle = path.join( env.root, 'blueprint.zip' );
			const cli = async ( ...args: string[] ) => {
				const result = await runCli( args, env! );
				expect( result.code, result.stderr + result.stdout ).toBe( 0 );
				return result.stdout.trim().split( '\n' ).at( -1 )!;
			};
			const wp = ( site: string, ...args: string[] ) => cli( 'wp', ...args, '--path', site );
			await cli(
				'site',
				'create',
				'--name',
				'Recipe source',
				'--path',
				source,
				'--wp',
				'latest',
				'--no-start',
				'--skip-browser'
			);
			const wpVersion = await wp( source, 'core', 'version' );
			fs.symlinkSync( wordpress, path.join( wordpressVersions, wpVersion ), 'junction' );
			const sourceUrl = await wp( source, 'option', 'get', 'home' );
			const image = path.join( source, 'blueprint-test.png' );
			fs.writeFileSync(
				image,
				Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aP8AAAAASUVORK5CYII=',
					'base64'
				)
			);
			const imageId = await wp(
				source,
				'media',
				'import',
				image,
				'--title=Reference image',
				'--porcelain'
			);
			const imageUrl = await wp( source, 'post', 'get', imageId, '--field=guid' );
			const page = await wp(
				source,
				'post',
				'create',
				'--post_type=page',
				'--post_status=publish',
				'--post_title=Our designed page',
				`--post_content=<!-- wp:image {"id":${ imageId }} --><figure class="wp-block-image"><img src="${ imageUrl }" class="wp-image-${ imageId }"/></figure><!-- /wp:image --><p><a href="${ sourceUrl }/about/">About</a></p>`,
				'--porcelain'
			);
			const navigation = await wp(
				source,
				'post',
				'create',
				'--post_type=wp_navigation',
				'--post_status=publish',
				'--post_title=Blueprint menu',
				'--post_content=<!-- wp:navigation-link {"label":"About","url":"/about/"} /-->',
				'--porcelain'
			);
			const parentTheme = await wp( source, 'option', 'get', 'stylesheet' );
			if ( running ) {
				const child = path.join( source, 'wp-content/themes/blueprint-child' );
				fs.mkdirSync( child );
				fs.writeFileSync(
					path.join( child, 'style.css' ),
					`/* Theme Name: Blueprint Child\nTemplate: ${ parentTheme }\n*/`
				);
				await wp( source, 'theme', 'activate', 'blueprint-child' );
			}
			const theme = await wp( source, 'option', 'get', 'stylesheet' );
			const themeDirectory = path.join( source, 'wp-content/themes', theme );
			fs.writeFileSync( path.join( themeDirectory, '.env' ), 'synthetic-theme-secret' );
			fs.writeFileSync( path.join( themeDirectory, 'private.sqlite' ), 'synthetic-database' );
			const header = await wp(
				source,
				'post',
				'create',
				'--post_type=wp_template_part',
				'--post_status=publish',
				'--post_title=Header',
				'--post_name=header',
				`--post_content=<!-- wp:paragraph --><p>Blueprint header <a href="${ sourceUrl }/about/">About</a></p><!-- /wp:paragraph --><!-- wp:navigation {"ref":${ navigation }} /-->`,
				'--porcelain'
			);
			await wp( source, 'post', 'term', 'set', header, 'wp_theme', theme );
			await wp( source, 'post', 'term', 'set', header, 'wp_template_part_area', 'header' );
			await wp( source, 'plugin', 'activate', 'hello' );
			if ( running ) {
				await wp( source, 'plugin', 'install', 'woocommerce', '--activate' );
				const product = await wp(
					source,
					'post',
					'create',
					'--post_type=product',
					'--post_status=publish',
					'--post_title=Sample product',
					'--porcelain'
				);
				await wp( source, 'post', 'meta', 'update', product, '_regular_price', '42' );
				await wp( source, 'post', 'meta', 'update', product, '_price', '42' );
				await wp( source, 'post', 'meta', 'update', product, '_sku', 'starter-product' );
				await wp( source, 'post', 'meta', 'update', product, '_thumbnail_id', imageId );
				await wp( source, 'post', 'term', 'set', product, 'product_type', 'simple' );
				await wp( source, 'option', 'update', 'woocommerce_currency', 'EUR' );
				await wp(
					source,
					'eval',
					`
					$attribute_id = wc_create_attribute( array( 'name' => 'Color', 'slug' => 'color' ) );
					register_taxonomy( 'pa_color', array( 'product' ) );
					$term = wp_insert_term( 'Blue', 'pa_color', array( 'slug' => 'blue' ) );
					$attribute = new WC_Product_Attribute();
					$attribute->set_id( $attribute_id );
					$attribute->set_name( 'pa_color' );
					$attribute->set_options( array( (int) $term['term_id'] ) );
					$attribute->set_visible( true );
					$attribute->set_variation( true );
					$parent = new WC_Product_Variable();
					$parent->set_name( 'Variable product' );
					$parent->set_sku( 'starter-variable' );
					$parent->set_status( 'publish' );
					$parent->set_attributes( array( $attribute ) );
					$parent_id = $parent->save();
					$variation = new WC_Product_Variation();
					$variation->set_parent_id( $parent_id );
					$variation->set_attributes( array( 'pa_color' => 'blue' ) );
					$variation->set_regular_price( '29' );
					$variation->set_status( 'publish' );
					$variation->save();
					WC_Product_Variable::sync( $parent_id );
				`
				);
			}
			await wp(
				source,
				'eval',
				"wp_update_custom_css_post( 'body { color: rgb(42, 23, 11); }' );"
			);
			await wp( source, 'option', 'update', 'show_on_front', 'page' );
			await wp( source, 'option', 'update', 'page_on_front', page );
			await wp(
				source,
				'post',
				'create',
				'--post_type=page',
				'--post_status=draft',
				'--post_title=Private draft'
			);
			await wp( source, 'option', 'update', 'blueprint_private_token', 'synthetic-secret-value' );
			await wp(
				source,
				'user',
				'create',
				'privateuser',
				'private@example.invalid',
				'--user_pass=synthetic-password'
			);
			if ( running ) await cli( 'site', 'start', '--path', source, '--skip-browser' );
			await cli( 'export', bundle, '--path', source, '--mode', 'blueprint' );
			await using opened = await openBlueprint( bundle );
			const root = path.dirname( opened.path );
			expect( fs.existsSync( path.join( root, 'site.zip' ) ) ).toBe( false );
			expect( fs.existsSync( path.join( root, 'content.json' ) ) ).toBe( true );
			const exported = fs.readFileSync( path.join( root, 'content.json' ), 'utf8' );
			expect( exported ).not.toContain( 'synthetic-secret-value' );
			expect( exported ).not.toContain( 'private@example.invalid' );
			expect( exported ).not.toContain( 'Private draft' );
			expect( exported ).not.toContain( sourceUrl );
			expect( JSON.stringify( opened.blueprint.steps ) ).not.toContain( 'importWordPressFiles' );
			const exportedTheme = path.join( env.root, 'exported-theme' );
			fs.mkdirSync( exportedTheme );
			await extractZip( path.join( root, 'theme.zip' ), exportedTheme );
			expect( fs.existsSync( path.join( exportedTheme, theme, '.env' ) ) ).toBe( false );
			expect( fs.existsSync( path.join( exportedTheme, theme, 'private.sqlite' ) ) ).toBe( false );
			await cli(
				'site',
				'create',
				'--name',
				'Recipe target',
				'--path',
				target,
				'--blueprint',
				bundle,
				'--no-start',
				'--skip-browser'
			);
			const targetUrl = await wp( target, 'option', 'get', 'home' );
			const pages = await wp( target, 'post', 'list', '--post_type=page', '--format=json' );
			const targetPage = JSON.parse( pages ).find(
				( post: { post_title: string } ) => post.post_title === 'Our designed page'
			);
			expect( targetPage ).toBeDefined();
			const content = await wp(
				target,
				'post',
				'get',
				String( targetPage.ID ),
				'--field=post_content'
			);
			expect( content ).toContain( `${ targetUrl }/about/` );
			expect( content ).not.toContain( sourceUrl );
			expect( content ).toContain( '/wp-content/uploads/' );
			expect( await wp( target, 'option', 'get', 'page_on_front' ) ).toBe(
				String( targetPage.ID )
			);
			expect( await wp( target, 'user', 'list', '--field=user_login' ) ).not.toContain(
				'privateuser'
			);
			await wp( target, 'plugin', 'is-active', 'hello-dolly' );
			if ( running ) {
				await wp( target, 'plugin', 'is-active', 'woocommerce' );
				const products = JSON.parse(
					await wp( target, 'post', 'list', '--post_type=product', '--format=json' )
				);
				const product = products.find(
					( item: { post_title: string } ) => item.post_title === 'Sample product'
				);
				expect( product ).toBeDefined();
				expect( await wp( target, 'post', 'meta', 'get', String( product.ID ), '_price' ) ).toBe(
					'42'
				);
				expect( await wp( target, 'post', 'meta', 'get', String( product.ID ), '_sku' ) ).toBe(
					'starter-product'
				);
				expect( await wp( target, 'option', 'get', 'woocommerce_currency' ) ).toBe( 'EUR' );
				const variation = JSON.parse(
					await wp(
						target,
						'eval',
						`
						$product = wc_get_product( wc_get_product_id_by_sku( 'starter-variable' ) );
						$children = $product ? $product->get_children() : array();
						$child = $children ? wc_get_product( $children[0] ) : null;
						echo wp_json_encode( array( 'type' => $product ? $product->get_type() : null, 'price' => $child ? $child->get_price() : null, 'attributes' => $child ? $child->get_attributes() : null ) );
					`
					)
				);
				expect( variation ).toEqual( {
					type: 'variable',
					price: '29',
					attributes: { pa_color: 'blue' },
				} );
			}
			expect( await wp( target, 'eval', 'echo wp_get_custom_css();' ) ).toContain(
				'rgb(42, 23, 11)'
			);
			const targetNavigation = JSON.parse(
				await wp( target, 'post', 'list', '--post_type=wp_navigation', '--format=json' )
			).find( ( post: { post_title: string } ) => post.post_title === 'Blueprint menu' );
			expect( targetNavigation ).toBeDefined();
			const targetHeader = fs.readFileSync(
				path.join( target, 'wp-content/themes', theme, 'parts/header.html' ),
				'utf8'
			);
			expect( targetHeader ).toContain( 'Blueprint header' );
			expect( targetHeader ).toContain( `${ targetUrl }/about/` );
			expect( targetHeader ).toContain( `"ref":${ targetNavigation.ID }` );
			if ( ! running ) {
				const outputInTheme = path.join( themeDirectory, 'existing-blueprint.zip' );
				fs.writeFileSync( outputInTheme, 'old Blueprint' );
				await cli( 'export', outputInTheme, '--path', source, '--mode', 'blueprint' );
				await using nested = await openBlueprint( outputInTheme );
				const extracted = path.join( env.root, 'theme-with-output' );
				fs.mkdirSync( extracted );
				await extractZip( path.join( path.dirname( nested.path ), 'theme.zip' ), extracted );
				expect( fs.existsSync( path.join( extracted, theme, 'existing-blueprint.zip' ) ) ).toBe(
					false
				);
			}
			const oldBundle = fs.readFileSync( bundle );
			const font = await wp(
				source,
				'post',
				'create',
				'--post_type=wp_font_family',
				'--post_status=publish',
				'--post_title=Installed font',
				'--porcelain'
			);
			const unsupportedFont = await runCli(
				[ 'export', bundle, '--path', source, '--mode', 'blueprint' ],
				env
			);
			expect( unsupportedFont.code ).not.toBe( 0 );
			expect( unsupportedFont.stderr + unsupportedFont.stdout ).toContain( 'font library' );
			expect( fs.readFileSync( bundle ) ).toEqual( oldBundle );
			await wp( source, 'post', 'delete', font, '--force' );
			if ( process.platform !== 'win32' ) {
				const link = path.join( themeDirectory, 'external.php' );
				fs.symlinkSync( path.join( source, 'wp-config.php' ), link );
				const linkedTheme = await runCli(
					[ 'export', bundle, '--path', source, '--mode', 'blueprint' ],
					env
				);
				expect( linkedTheme.code ).not.toBe( 0 );
				expect( linkedTheme.stderr + linkedTheme.stdout ).toContain( 'symbolic link' );
				expect( fs.readFileSync( bundle ) ).toEqual( oldBundle );
				fs.unlinkSync( link );
			}
			await wp(
				source,
				'eval',
				"register_post_type('portfolio', array('public' => true)); wp_insert_post(array('post_type' => 'portfolio', 'post_status' => 'publish', 'post_title' => 'Custom content'));"
			);
			const unsupported = await runCli(
				[ 'export', bundle, '--path', source, '--mode', 'blueprint' ],
				env
			);
			expect( unsupported.code ).not.toBe( 0 );
			expect( unsupported.stderr + unsupported.stdout ).toContain( 'portfolio' );
			expect( fs.readFileSync( bundle ) ).toEqual( oldBundle );
			expect(
				fs.readdirSync( source ).some( ( entry ) => entry.startsWith( '.studio-blueprint-' ) )
			).toBe( false );
		}
	);
} );
