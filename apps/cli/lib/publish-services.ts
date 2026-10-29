import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readAuthToken } from '@studio/common/lib/shared-config';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { chromium } from 'playwright';
import { z } from 'zod';
import { runCommand as push } from 'cli/commands/push';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { withSiteOperation } from 'cli/lib/site-operations';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { findSyncSiteByIdentifier } from 'cli/lib/sync-site-picker';
import { validatePhpVersion } from 'cli/lib/utils';
import { Logger } from 'cli/logger';
import type {
	PublishServices,
	Visibility,
	Manifest,
	Target,
	LocalAccessOptions,
} from './publish-operation';
import type { SyncCommandLoggerAction } from '@studio/common/logger-actions';

const remoteSchema = z.object( {
	ID: z.number(),
	URL: z.string().url(),
	is_private: z.boolean(),
	is_coming_soon: z.boolean(),
	launch_status: z.string().optional(),
	options: z
		.object( {
			blog_public: z
				.preprocess(
					( value ) =>
						typeof value === 'string' && /^-?[01]$/.test( value ) ? Number( value ) : value,
					z.union( [ z.literal( -1 ), z.literal( 0 ), z.literal( 1 ) ] )
				)
				.optional(),
		} )
		.optional(),
} );
export function contentFingerprint( content: string, from: string, to: string ) {
	const source = from.replace( /\/$/, '' );
	const destination = to.replace( /\/$/, '' );
	const normalized = content
		.split( source )
		.join( destination )
		.split( source.split( '/' ).join( '\\/' ) )
		.join( destination.split( '/' ).join( '\\/' ) );
	return createHash( 'sha256' ).update( normalized ).digest( 'hex' );
}
export function assertAnonymousVisibility(
	expected: Visibility,
	body: string,
	url: string,
	status: number,
	barrier: 'private' | 'coming-soon' | null = null
) {
	const text = body.toLowerCase();
	const parsed = new URL( url );
	const login =
		expected.private &&
		parsed.hostname === 'wordpress.com' &&
		parsed.pathname.startsWith( '/log-in' );
	if ( ! login && parsed.origin !== new URL( expected.url ).origin )
		throw new Error( 'Anonymous access redirected outside the selected destination.' );
	if ( status < 200 || status >= 500 ) throw new Error( 'Anonymous access could not be verified.' );
	if ( expected.private ) {
		if ( ! login && barrier !== 'private' )
			throw new Error( 'Anonymous private access was not blocked.' );
	} else if ( expected.comingSoon ) {
		if ( barrier !== 'coming-soon' )
			throw new Error( 'Coming Soon is not protecting the published site.' );
	} else if ( status < 200 || status >= 400 || /fatal error:|parse error:/i.test( text ) )
		throw new Error( 'The published page does not render successfully.' );
}
export async function createPublishServices( sitePath: string ): Promise< PublishServices > {
	const token = await readAuthToken();
	if ( ! token ) throw new Error( 'Log in with studio auth login before publishing.' );
	const getSite = () => getSiteByFolder( sitePath );
	const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
	let target: Target | undefined;
	const wp = async ( code: string ) => {
		const site = await getSite();
		await using child = await runWpCliCommand( site, [ 'eval', code ], {
			phpVersion: validatePhpVersion( site.phpVersion ),
		} );
		const [ exitCode, stdout, stderr ] = await Promise.all( [
			child.response.exitCode,
			child.response.stdoutText,
			child.response.stderrText,
		] );
		if ( exitCode !== 0 )
			throw new Error( 'Local WordPress command failed: ' + stderr.slice( -1000 ) );
		return JSON.parse( stdout ) as unknown;
	};
	const snapshot = async ( remote: Target ): Promise< Visibility > => {
		const sites = z
			.object( { sites: z.array( z.object( { ID: z.number() } ).passthrough() ) } )
			.parse(
				await wpcom.req.get(
					{ apiNamespace: 'rest/v1.2', path: '/me/sites' },
					{
						fields: 'ID,URL,is_private,is_coming_soon,launch_status,options',
						options: 'blog_public',
					}
				)
			);
		const selected = sites.sites.find( ( site ) => site.ID === remote.id );
		if ( ! selected ) throw new Error( 'Destination visibility could not be resolved.' );
		const value = remoteSchema.parse( selected );
		const blogPublic = value.options?.blog_public;
		if ( blogPublic === undefined )
			throw new Error( 'Destination visibility metadata is incomplete.' );
		if ( ! [ -1, 0, 1 ].includes( blogPublic ) )
			throw new Error( 'Unsupported destination visibility.' );
		return {
			id: value.ID,
			url: value.URL,
			private: value.is_private,
			comingSoon: value.is_coming_soon,
			blogPublic,
			launchStatus: value.launch_status ?? null,
		};
	};
	const collection = async ( remote: Target, resource: string, fields: string ) => {
		const entries: unknown[] = [];
		for ( let page = 1; page <= 50; page++ ) {
			const result = await wpcom.req.get(
				{ apiNamespace: 'wp/v2', path: '/sites/' + remote.id + '/' + resource },
				{
					context: 'edit',
					per_page: 100,
					page,
					_fields: fields,
				}
			);
			const batch = z.array( z.unknown() ).parse( result );
			entries.push( ...batch );
			if ( batch.length < 100 ) return entries;
		}
		throw new Error( 'Remote collection exceeds this prototype verification limit.' );
	};
	const verifyAccess: PublishServices[ 'verifyAccess' ] = async (
		remote,
		manifest,
		expected,
		directory
	) => {
		const urls = [
			...new Set( [
				remote.url,
				...manifest.pages.map(
					( entry ) =>
						entry.url ??
						new URL( encodeURIComponent( entry.slug ) + '/', remote.url.replace( /\/$/, '' ) + '/' )
							.href
				),
			] ),
		];
		fs.mkdirSync( directory, { recursive: true, mode: 0o700 } );
		const browser = await chromium.launch( { headless: true } );
		const screenshot = path.join( directory, 'anonymous-access.png' );
		try {
			for ( const [ index, url ] of urls.entries() ) {
				const requestUrl = new URL( url );
				if ( requestUrl.origin !== new URL( remote.url ).origin )
					throw new Error( 'Page access check points outside the selected destination.' );
				requestUrl.searchParams.set( 'studio-access-check', randomUUID() );
				const context = await browser.newContext();
				try {
					const page = await context.newPage();
					const response = await page.goto( requestUrl.href, {
						waitUntil: 'load',
						timeout: 30000,
					} );
					await page.screenshot( {
						path:
							index === 0
								? screenshot
								: path.join( directory, 'anonymous-access-' + index + '.png' ),
						fullPage: true,
					} );
					const access = await page.evaluate(
						( { origin, mediaFiles } ) => {
							const loginLink = [
								...document.querySelectorAll< HTMLAnchorElement >( 'a[href]' ),
							].some( ( link ) => {
								const value = new URL( link.href );
								return value.origin === origin && value.pathname === '/wp-login.php';
							} );
							// Provider templates: Automattic/wpcom-site-helper private-site/ and jetpack-mu-wpcom coming-soon/.
							const comingSoon =
								loginLink &&
								( ( document.body.matches( '.wpcom-coming-soon-body' ) &&
									!! document.querySelector( '.wpcom-coming-soon-main' ) ) ||
									( document.body.matches( '.wpcom-coming-soon-private-default-body' ) &&
										!! document.querySelector( '.inner .main .description' ) ) );
							const privateSite =
								loginLink &&
								document.body.matches( '.login' ) &&
								!! document.querySelector( '#login .message a.button-primary' );
							const resources = performance
								.getEntriesByType( 'resource' )
								.map( ( entry ) => entry.name );
							const mediaVisible = resources.some( ( resource ) => {
								try {
									return mediaFiles.includes(
										decodeURIComponent( new URL( resource ).pathname.split( '/' ).pop() ?? '' )
									);
								} catch {
									return false;
								}
							} );
							return {
								barrier: comingSoon
									? ( 'coming-soon' as const )
									: privateSite
									? ( 'private' as const )
									: null,
								mediaVisible,
							};
						},
						{
							origin: new URL( remote.url ).origin,
							mediaFiles: manifest.media.map( ( entry ) => entry.file ),
						}
					);
					if ( expected.private || expected.comingSoon ) {
						if ( access.mediaVisible )
							throw new Error( 'Restricted site media is visible to anonymous visitors: ' + url );
						const text = ( ( await page.locator( 'body' ).textContent() ) ?? '' ).replace(
							/\s+/g,
							''
						);
						if (
							manifest.pages.some(
								( p ) => p.probe && p.probe.length > 20 && text.includes( p.probe )
							)
						)
							throw new Error( 'Restricted site content is visible to anonymous visitors: ' + url );
					}
					assertAnonymousVisibility(
						expected,
						await page.locator( 'body' ).innerText(),
						page.url(),
						response?.status() ?? 0,
						access.barrier
					);
				} finally {
					await context.close();
				}
			}
		} finally {
			await browser.close();
		}
		return screenshot;
	};
	return {
		resolve: async ( identifier ) => {
			const remote = findSyncSiteByIdentifier(
				await fetchSyncableSites( token.accessToken ),
				identifier
			);
			if ( new URL( remote.url ).protocol !== 'https:' )
				throw new Error( 'Publishing requires an HTTPS destination.' );
			target = { id: remote.id, url: remote.url };
			return target;
		},
		snapshot,
		verifyAccess,
		makePrivate: async ( remote ) => {
			await wpcom.req.post( {
				apiNamespace: 'rest/v1.1',
				path: '/sites/' + remote.id + '/settings',
				body: { blog_public: -1 },
			} );
		},
		localVisibility: async () =>
			z
				.string()
				.regex( /^(?:-1|0|1)$/ )
				.parse( await wp( 'echo wp_json_encode((string)get_option("blog_public"));' ) ),
		localAccessOptions: async () =>
			z
				.object( {
					wpcom_coming_soon: z.union( [ z.literal( 0 ), z.literal( 1 ) ] ).nullable(),
					wpcom_public_coming_soon: z.union( [ z.literal( 0 ), z.literal( 1 ) ] ).nullable(),
				} )
				.parse(
					await wp(
						'$result=[];foreach(["wpcom_coming_soon","wpcom_public_coming_soon"] as $key){$value=get_option($key,null);$result[$key]=$value===null?null:(int)$value;}echo wp_json_encode($result);'
					)
				),
		setLocalAccessOptions: async ( value: LocalAccessOptions ) => {
			const statements = Object.entries( value )
				.map( ( [ key, setting ] ) => {
					if (
						! [ 'wpcom_coming_soon', 'wpcom_public_coming_soon' ].includes( key ) ||
						! [ null, 0, 1 ].includes( setting )
					)
						throw new Error( 'Invalid local Coming Soon setting.' );
					return setting === null
						? 'delete_option("' + key + '");'
						: 'update_option("' + key + '",' + setting + ');';
				} )
				.join( '' );
			await wp( statements + 'echo "true";' );
		},
		withLocalExportLock: async ( action ) =>
			withSiteOperation( ( await getSite() ).path, 'export', action ),
		setLocalVisibility: async ( value ) => {
			if ( ! [ '-1', '0', '1' ].includes( value ) ) throw new Error( 'Invalid visibility value.' );
			const actual = await wp(
				'update_option("blog_public",' +
					Number( value ) +
					');echo wp_json_encode((string)get_option("blog_public"));'
			);
			if ( actual !== value )
				throw new Error( 'Local export visibility did not change as requested.' );
		},
		manifest: async () => {
			if ( ! target ) throw new Error( 'Resolve the remote before capturing its manifest.' );
			const value = z
				.object( {
					url: z.string(),
					pages: z.array(
						z.object( {
							slug: z.string(),
							title: z.string(),
							content: z.string(),
							probe: z.string(),
							url: z.string().url(),
						} )
					),
					media: z.array( z.object( { url: z.string() } ) ),
				} )
				.parse(
					await wp(
						'echo wp_json_encode(["url"=>home_url(),"pages"=>array_map(function($p){return ["slug"=>$p->post_name,"title"=>$p->post_title,"url"=>get_permalink($p),"content"=>$p->post_content,"probe"=>html_entity_decode(wp_strip_all_tags($p->post_content),ENT_QUOTES|ENT_HTML5,"UTF-8")];},get_posts(["post_type"=>"page","post_status"=>"publish","numberposts"=>-1])),"media"=>array_map(function($p){return ["url"=>wp_get_attachment_url($p->ID)];},get_posts(["post_type"=>"attachment","post_status"=>"inherit","numberposts"=>-1]))]);'
					)
				);
			if ( ! value.pages.length ) throw new Error( 'The local site has no published pages.' );
			return {
				pages: value.pages.map( ( p ) => ( {
					slug: p.slug,
					title: p.title,
					hash: contentFingerprint( p.content, value.url, target!.url ),
					probe: p.probe.replace( /\s+/g, '' ).slice( 0, 120 ),
					url: new URL( new URL( p.url ).pathname + new URL( p.url ).search, target!.url ).href,
				} ) ),
				media: value.media.map( ( m ) => ( {
					file: path.posix.basename( new URL( m.url ).pathname ),
				} ) ),
			};
		},
		push: async ( remote, hooks ) => {
			const site = await getSite();
			const logger = new Logger< SyncCommandLoggerAction >( {
				onProgress: ( message ) => process.stderr.write( message + '\n' ),
			} );
			const result = await push( site.path, [ 'all' ], String( remote.id ), logger, hooks );
			if ( ! result || result.id !== remote.id )
				throw new Error( 'Studio did not confirm the selected destination transfer.' );
		},
		verify: async ( remote, manifest: Manifest, expected, directory ) => {
			const [ pages, media ] = await Promise.all( [
				manifest.pages.length ? collection( remote, 'pages', 'id,slug,status,content' ) : [],
				manifest.media.length ? collection( remote, 'media', 'id,source_url,media_details' ) : [],
			] );
			const remotePages = z
				.array( z.object( { slug: z.string(), content: z.object( { raw: z.string() } ) } ) )
				.parse( pages );
			for ( const page of manifest.pages ) {
				const found = remotePages.find( ( p ) => p.slug === page.slug );
				if (
					! found ||
					contentFingerprint( found.content.raw, remote.url, remote.url ) !== page.hash
				)
					throw new Error( 'Published page does not match the local build: ' + page.slug );
			}
			const remoteMedia = z
				.array(
					z.object( {
						source_url: z.string().url(),
						media_details: z
							.object( { width: z.number().optional(), height: z.number().optional() } )
							.optional(),
					} )
				)
				.parse( media );
			for ( const image of manifest.media ) {
				const found = remoteMedia.find(
					( m ) => path.posix.basename( new URL( m.source_url ).pathname ) === image.file
				);
				if ( ! found ) throw new Error( 'Published media is missing: ' + image.file );
				const imageUrl = new URL( found.source_url );
				if ( imageUrl.origin !== new URL( remote.url ).origin )
					throw new Error( 'Media points outside the selected destination.' );
				if ( ! expected.private ) {
					const response = await fetch( imageUrl, {
						method: 'HEAD',
						redirect: 'error',
						signal: AbortSignal.timeout( 30000 ),
					} );
					if ( ! response.ok || ! response.headers.get( 'content-type' )?.startsWith( 'image/' ) )
						throw new Error( 'Published image is not readable: ' + image.file );
				}
			}
			const screenshot = await verifyAccess( remote, manifest, expected, directory );
			return {
				pages: manifest.pages.length,
				media: manifest.media.length,
				visibility: expected.private ? 'private' : expected.comingSoon ? 'coming-soon' : 'public',
				screenshot,
			};
		},
	};
}
