import {
	BASE_CSS,
	getAgentsMd,
	GITIGNORE,
	type FrontendTemplateContext,
	type FrontendTemplateFiles,
} from './shared';

function packageJson( context: FrontendTemplateContext ): string {
	return (
		JSON.stringify(
			{
				name: context.packageName,
				private: true,
				scripts: {
					dev: 'next dev',
					build: 'next build',
					start: 'next start',
				},
				dependencies: {
					next: '^16.0.0',
					react: '^19.2.0',
					'react-dom': '^19.2.0',
				},
				devDependencies: {
					'@types/node': '^22.0.0',
					'@types/react': '^19.0.0',
					'@types/react-dom': '^19.0.0',
					typescript: '^5.6.0',
				},
			},
			null,
			2
		) + '\n'
	);
}

const NEXT_CONFIG = `import type { NextConfig } from 'next';

const wordpressUrl = new URL( process.env.WORDPRESS_URL || 'http://localhost' );

const nextConfig: NextConfig = {
	images: {
		remotePatterns: [
			{
				protocol: wordpressUrl.protocol === 'https:' ? 'https' : 'http',
				hostname: process.env.WORDPRESS_HOSTNAME || wordpressUrl.hostname,
				port: wordpressUrl.port,
				pathname: '/wp-content/uploads/**',
			},
		],
	},
};

export default nextConfig;
`;

const TSCONFIG =
	JSON.stringify(
		{
			compilerOptions: {
				target: 'ES2022',
				lib: [ 'dom', 'dom.iterable', 'esnext' ],
				allowJs: false,
				skipLibCheck: true,
				strict: true,
				noEmit: true,
				esModuleInterop: true,
				module: 'esnext',
				moduleResolution: 'bundler',
				resolveJsonModule: true,
				isolatedModules: true,
				jsx: 'react-jsx',
				incremental: true,
				plugins: [ { name: 'next' } ],
				paths: { '@/*': [ './*' ] },
			},
			include: [ 'next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts' ],
			exclude: [ 'node_modules' ],
		},
		null,
		2
	) + '\n';

const WORDPRESS_TS = `// A small client for the WordPress REST API. Studio sets these in .env.local;
// they are server-side only, so never import this file from a client component.
const WORDPRESS_URL = ( process.env.WORDPRESS_URL ?? '' ).replace( /\\/$/, '' );

export interface WPPost {
	id: number;
	slug: string;
	type: string;
	status: string;
	date: string;
	title: { rendered: string };
	excerpt: { rendered: string };
	content: { rendered: string };
	_embedded?: {
		'wp:featuredmedia'?: Array< { source_url?: string; alt_text?: string } >;
	};
}

const PREVIEW_STATUSES = 'publish,draft,pending,future,private';

// Basic auth with the application password; only used to read drafts.
function authHeaders(): Record< string, string > {
	const user = process.env.WORDPRESS_APPLICATION_USER;
	const password = process.env.WORDPRESS_APPLICATION_PASSWORD;
	if ( ! user || ! password ) {
		return {};
	}
	return { Authorization: 'Basic ' + Buffer.from( user + ':' + password ).toString( 'base64' ) };
}

// Published content is cached under tags that WordPress revalidates
// (\`post\`, \`post:<id>\`, \`post:<slug>\`); drafts are never cached.
async function wpFetch< T >(
	path: string,
	{ preview = false, tags = [] }: { preview?: boolean; tags?: string[] } = {}
): Promise< T > {
	if ( ! WORDPRESS_URL ) {
		throw new Error( 'WORDPRESS_URL is not set. Studio writes it to .env.local.' );
	}
	const response = await fetch(
		WORDPRESS_URL + '/wp-json/wp/v2' + path,
		preview
			? { headers: authHeaders(), cache: 'no-store' }
			: { next: { tags: [ 'wordpress', ...tags ] } }
	);
	if ( ! response.ok ) {
		throw new Error( 'WordPress responded with ' + response.status + ' for ' + path );
	}
	return ( await response.json() ) as T;
}

function restBase( type: string ): string {
	return type === 'post' ? 'posts' : type === 'page' ? 'pages' : type;
}

export function getPosts( perPage = 20 ): Promise< WPPost[] > {
	return wpFetch< WPPost[] >( '/posts?_embed&per_page=' + perPage, { tags: [ 'post' ] } );
}

async function getBySlug( type: string, slug: string, preview: boolean ) {
	// A draft has no slug yet, so the draft route links to its ID instead.
	if ( preview && /^\\d+$/.test( slug ) ) {
		return getDraft( slug, type ).catch( () => undefined );
	}
	const status = preview ? '&status=' + PREVIEW_STATUSES : '';
	const items = await wpFetch< WPPost[] >(
		'/' + restBase( type ) + '?_embed&slug=' + encodeURIComponent( slug ) + status,
		{ preview, tags: [ type, type + ':' + slug ] }
	);
	return items[ 0 ];
}

export function getPostBySlug( slug: string, preview = false ) {
	return getBySlug( 'post', slug, preview );
}

export function getPageBySlug( slug: string, preview = false ) {
	return getBySlug( 'page', slug, preview );
}

export function getDraft( id: string | number, type = 'post' ): Promise< WPPost > {
	return wpFetch< WPPost >( '/' + restBase( type ) + '/' + encodeURIComponent( String( id ) ) + '?_embed', {
		preview: true,
	} );
}

export function featuredImage( post: WPPost ) {
	const image = post._embedded?.[ 'wp:featuredmedia' ]?.[ 0 ];
	return image?.source_url ? { src: image.source_url, alt: image.alt_text ?? '' } : undefined;
}

export function formatDate( value: string ): string {
	return new Date( value ).toLocaleDateString( 'en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	} );
}

export function stripTags( html: string ): string {
	return html.replace( /<[^>]+>/g, '' );
}
`;

function layoutTsx( context: FrontendTemplateContext ): string {
	return `import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

const SITE_NAME = ${ JSON.stringify( context.siteName ) };

export const metadata: Metadata = {
	title: { default: SITE_NAME, template: '%s – ' + SITE_NAME },
};

export default function RootLayout( { children }: { children: ReactNode } ) {
	return (
		<html lang="en">
			<body>
				<header className="site-header">
					<Link className="site-title" href="/">
						{ SITE_NAME }
					</Link>
				</header>
				<main className="container">{ children }</main>
				<footer className="site-footer">
					<span>Content from WordPress, built with Next.js.</span>
				</footer>
			</body>
		</html>
	);
}
`;
}

const PAGE_TSX = `import Link from 'next/link';
import { featuredImage, formatDate, getPosts, type WPPost } from '@/lib/wordpress';

export default async function Home() {
	let posts: WPPost[] = [];
	let error = '';
	try {
		posts = await getPosts();
	} catch ( e ) {
		error = e instanceof Error ? e.message : String( e );
	}

	if ( error ) {
		return <p className="notice">Could not load posts from WordPress. Is the site running? ({ error })</p>;
	}
	if ( posts.length === 0 ) {
		return <p className="notice">No posts yet. Publish one in WordPress and reload.</p>;
	}

	return (
		<ul className="posts">
			{ posts.map( ( post ) => {
				const image = featuredImage( post );
				return (
					<li className="post-card" key={ post.id }>
						{ image && <img className="featured" src={ image.src } alt={ image.alt } /> }
						<h2>
							<Link href={ '/posts/' + post.slug }>
								<span dangerouslySetInnerHTML={ { __html: post.title.rendered } } />
							</Link>
						</h2>
						<div className="meta">{ formatDate( post.date ) }</div>
						<div className="excerpt" dangerouslySetInnerHTML={ { __html: post.excerpt.rendered } } />
					</li>
				);
			} ) }
		</ul>
	);
}
`;

const PREVIEW_BANNER = `function PreviewBanner() {
	return (
		<p className="notice">
			Previewing unpublished changes. <a href="/api/disable-draft">Exit preview</a>
		</p>
	);
}`;

const POST_PAGE_TSX = `import type { Metadata } from 'next';
import { draftMode } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { featuredImage, formatDate, getPostBySlug, stripTags } from '@/lib/wordpress';

type Props = { params: Promise< { slug: string } > };

export async function generateMetadata( { params }: Props ): Promise< Metadata > {
	const { slug } = await params;
	const { isEnabled } = await draftMode();
	const post = await getPostBySlug( slug, isEnabled ).catch( () => undefined );
	return { title: post ? stripTags( post.title.rendered ) : 'Not found' };
}

${ PREVIEW_BANNER }

export default async function PostPage( { params }: Props ) {
	const { slug } = await params;
	const { isEnabled } = await draftMode();
	const post = await getPostBySlug( slug, isEnabled );
	if ( ! post ) {
		notFound();
	}
	const image = featuredImage( post );

	return (
		<article>
			{ isEnabled && <PreviewBanner /> }
			{ image && <img className="featured" src={ image.src } alt={ image.alt } /> }
			<h1 dangerouslySetInnerHTML={ { __html: post.title.rendered } } />
			<div className="meta">{ formatDate( post.date ) }</div>
			<div className="content" dangerouslySetInnerHTML={ { __html: post.content.rendered } } />
			<p>
				<Link href="/">← All posts</Link>
			</p>
		</article>
	);
}
`;

const WP_PAGE_TSX = `import type { Metadata } from 'next';
import { draftMode } from 'next/headers';
import { notFound } from 'next/navigation';
import { getPageBySlug, stripTags } from '@/lib/wordpress';

type Props = { params: Promise< { slug: string } > };

export async function generateMetadata( { params }: Props ): Promise< Metadata > {
	const { slug } = await params;
	const { isEnabled } = await draftMode();
	const page = await getPageBySlug( slug, isEnabled ).catch( () => undefined );
	return { title: page ? stripTags( page.title.rendered ) : 'Not found' };
}

${ PREVIEW_BANNER }

export default async function WordPressPage( { params }: Props ) {
	const { slug } = await params;
	const { isEnabled } = await draftMode();
	const page = await getPageBySlug( slug, isEnabled );
	if ( ! page ) {
		notFound();
	}

	return (
		<article>
			{ isEnabled && <PreviewBanner /> }
			<h1 dangerouslySetInnerHTML={ { __html: page.title.rendered } } />
			<div className="content" dangerouslySetInnerHTML={ { __html: page.content.rendered } } />
		</article>
	);
}
`;

const DRAFT_ROUTE_TS = `import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { getDraft, type WPPost } from '@/lib/wordpress';

// WordPress's Preview button opens /api/draft?secret=…&id=…&type=…&status=…
export async function GET( request: NextRequest ) {
	const params = request.nextUrl.searchParams;
	const id = params.get( 'id' );
	const type = params.get( 'type' ) || 'post';
	const secret = process.env.STUDIO_PREVIEW_SECRET;
	if ( ! secret || params.get( 'secret' ) !== secret || ! id || ! /^\\d+$/.test( id ) ) {
		return new Response( 'Invalid preview request', { status: 401 } );
	}

	let item: WPPost;
	try {
		item = await getDraft( id, type );
	} catch {
		return new Response( 'Content not found', { status: 404 } );
	}

	( await draftMode() ).enable();
	const slug = item.slug || String( item.id );
	redirect( type === 'page' ? '/' + slug : '/posts/' + slug );
}
`;

const DISABLE_DRAFT_ROUTE_TS = `import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';

export async function GET() {
	( await draftMode() ).disable();
	redirect( '/' );
}
`;

const REVALIDATE_ROUTE_TS = `import { revalidatePath, revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';

function toStrings( value: unknown ): string[] {
	return Array.isArray( value ) ? value.filter( ( item ): item is string => typeof item === 'string' ) : [];
}

function normalizePath( path: string ): string {
	return path.replace( /\\/+$/, '' ) || '/';
}

// WordPress POSTs { paths, tags } here when content changes, with the secret in
// the X-Studio-Revalidate-Secret header.
export async function POST( request: NextRequest ) {
	const secret = process.env.STUDIO_REVALIDATE_SECRET;
	if ( ! secret || request.headers.get( 'x-studio-revalidate-secret' ) !== secret ) {
		return Response.json( { revalidated: false, message: 'Invalid secret' }, { status: 401 } );
	}

	const body: { paths?: unknown; tags?: unknown } = await request.json().catch( () => ( {} ) );
	const requestedPaths = toStrings( body.paths ).filter( ( path ) => path.startsWith( '/' ) );
	const paths = [ ...new Set( ( requestedPaths.length ? requestedPaths : [ '/' ] ).map( normalizePath ) ) ];
	const tags = [ ...new Set( toStrings( body.tags ) ) ];

	for ( const path of paths ) {
		revalidatePath( path );
	}
	for ( const tag of tags ) {
		revalidateTag( tag, { expire: 0 } );
	}

	return Response.json( { revalidated: true, paths, tags } );
}
`;

function readme( context: FrontendTemplateContext ): string {
	return `# ${ context.siteName } frontend (Next.js)

A [Next.js](https://nextjs.org) App Router site that reads its content from a local WordPress site over the REST API, with WordPress previews and on-demand revalidation wired up. WordPress Studio created it next to the WordPress install and runs \`npm run dev\` for you.

## Run it

\`\`\`sh
npm install
npm run dev
\`\`\`

Studio starts the dev server on the port in \`.env.local\` (\`PORT\`) whenever the site starts.

## Environment

Studio writes \`.env.local\` with:

- \`WORDPRESS_URL\`: the WordPress site (${ context.wordpressUrl }).
- \`WORDPRESS_HOSTNAME\`: its hostname, used by \`images.remotePatterns\` in \`next.config.ts\`.
- \`WORDPRESS_APPLICATION_USER\` / \`WORDPRESS_APPLICATION_PASSWORD\`: credentials for reading drafts. Server-side only; never rename them with a \`NEXT_PUBLIC_\` prefix.
- \`STUDIO_PREVIEW_SECRET\`: checked by \`app/api/draft/route.ts\`.
- \`STUDIO_REVALIDATE_SECRET\`: checked by \`app/api/revalidate/route.ts\`.
- \`PORT\`: the dev server port.

## Previews

WordPress's Preview button opens \`/api/draft?secret=…&id=…&type=…&status=…\`. The route checks the secret, fetches the draft with the application password, turns on [draft mode](https://nextjs.org/docs/app/guides/draft-mode) and redirects to the post (\`/posts/<slug>\`) or page (\`/<slug>\`). A draft without a slug yet is shown at its ID. \`/api/disable-draft\` leaves draft mode. Previews of a published post show its saved content, not unsaved autosaves.

## Revalidation

Published content is fetched with cache tags (\`post\`, \`post:<id>\`, \`post:<slug>\`, and the same for pages). When a post is published, updated or unpublished, WordPress POSTs \`{ "paths": [...], "tags": [...] }\` to \`/api/revalidate\` with the \`X-Studio-Revalidate-Secret\` header, and the route calls \`revalidatePath\` and \`revalidateTag\`. In \`next dev\` nothing is cached, so this matters once you run \`next build && next start\` or deploy.
`;
}

export function getNextTemplate( context: FrontendTemplateContext ): FrontendTemplateFiles {
	return {
		'package.json': packageJson( context ),
		'next.config.ts': NEXT_CONFIG,
		'tsconfig.json': TSCONFIG,
		'lib/wordpress.ts': WORDPRESS_TS,
		'app/layout.tsx': layoutTsx( context ),
		'app/globals.css': BASE_CSS,
		'app/page.tsx': PAGE_TSX,
		'app/posts/[slug]/page.tsx': POST_PAGE_TSX,
		'app/[slug]/page.tsx': WP_PAGE_TSX,
		'app/api/draft/route.ts': DRAFT_ROUTE_TS,
		'app/api/disable-draft/route.ts': DISABLE_DRAFT_ROUTE_TS,
		'app/api/revalidate/route.ts': REVALIDATE_ROUTE_TS,
		'.gitignore': GITIGNORE,
		'README.md': readme( context ),
		'AGENTS.md': getAgentsMd( context, {
			stack: 'It is a Next.js 16 App Router site (React 19, TypeScript).',
			run: 'Run: `npm run dev` (Studio runs it on the frontend port when the site starts).',
			structure: [
				'`lib/wordpress.ts`: the REST client (`getPosts`, `getPostBySlug`, `getPageBySlug`, `getDraft`), server-side only. Published fetches carry cache tags; draft fetches use the application password and skip the cache.',
				'`app/page.tsx`: the post list. `app/posts/[slug]/page.tsx`: a post. `app/[slug]/page.tsx`: a page.',
				'`app/api/draft/route.ts` and `app/api/disable-draft/route.ts`: previews through draft mode.',
				'`app/api/revalidate/route.ts`: on-demand revalidation called by WordPress.',
				'`next.config.ts`: `images.remotePatterns` for the WordPress uploads.',
			],
			notes: [
				'Pages render on the server; keep WordPress credentials out of client components.',
				'Featured images use a plain `<img>`. To switch to `next/image`, keep the configured `remotePatterns`; Next.js 16 also refuses to optimize images from a loopback address unless `images.dangerouslyAllowLocalIP` is set, which a local WordPress site needs in development.',
			],
		} ),
	};
}
