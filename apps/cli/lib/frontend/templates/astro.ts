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
				type: 'module',
				scripts: {
					dev: 'astro dev',
					build: 'astro build',
					preview: 'astro preview',
				},
				dependencies: {
					astro: '^5.0.0',
				},
			},
			null,
			2
		) + '\n'
	);
}

const ASTRO_CONFIG = `import { defineConfig } from 'astro/config';

// Static output: \`astro dev\` renders every request, so WordPress changes show on
// reload. Previews need \`output: 'server'\` and an adapter (see README.md).
export default defineConfig( {
	server: { port: Number( process.env.PORT ) || 4321 },
} );
`;

const TSCONFIG = `{
	"extends": "astro/tsconfigs/strict",
	"include": [ ".astro/types.d.ts", "**/*" ],
	"exclude": [ "dist" ]
}
`;

const ENV_D_TS = `interface ImportMetaEnv {
	readonly WORDPRESS_URL: string;
	readonly WORDPRESS_APPLICATION_USER?: string;
	readonly WORDPRESS_APPLICATION_PASSWORD?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
`;

const WORDPRESS_TS = `// A small client for the WordPress REST API. Studio sets WORDPRESS_URL in .env.local.
const WORDPRESS_URL = ( import.meta.env.WORDPRESS_URL ?? '' ).replace( /\\/$/, '' );

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

// Basic auth with the application password; only needed to read drafts.
function authHeaders(): Record< string, string > {
	const user = import.meta.env.WORDPRESS_APPLICATION_USER;
	const password = import.meta.env.WORDPRESS_APPLICATION_PASSWORD;
	if ( ! user || ! password ) {
		return {};
	}
	return { Authorization: 'Basic ' + btoa( user + ':' + password ) };
}

async function wpFetch< T >( path: string, { auth = false } = {} ): Promise< T > {
	if ( ! WORDPRESS_URL ) {
		throw new Error( 'WORDPRESS_URL is not set. Studio writes it to .env.local.' );
	}
	const response = await fetch( WORDPRESS_URL + '/wp-json/wp/v2' + path, {
		headers: auth ? authHeaders() : {},
	} );
	if ( ! response.ok ) {
		throw new Error( 'WordPress responded with ' + response.status + ' for ' + path );
	}
	return ( await response.json() ) as T;
}

export function getPosts( perPage = 20 ): Promise< WPPost[] > {
	return wpFetch< WPPost[] >( '/posts?_embed&per_page=' + perPage );
}

export async function getPostBySlug( slug: string ): Promise< WPPost | undefined > {
	const posts = await wpFetch< WPPost[] >( '/posts?_embed&slug=' + encodeURIComponent( slug ) );
	return posts[ 0 ];
}

export function getPages(): Promise< WPPost[] > {
	return wpFetch< WPPost[] >( '/pages?per_page=100' );
}

export async function getPageBySlug( slug: string ): Promise< WPPost | undefined > {
	const pages = await wpFetch< WPPost[] >( '/pages?_embed&slug=' + encodeURIComponent( slug ) );
	return pages[ 0 ];
}

export function getDraft( id: number, type = 'post' ): Promise< WPPost > {
	const base = type === 'page' ? 'pages' : type === 'post' ? 'posts' : type;
	return wpFetch< WPPost >( '/' + base + '/' + id + '?_embed', { auth: true } );
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
`;

function layoutAstro( context: FrontendTemplateContext ): string {
	return `---
import '../styles/global.css';

interface Props {
	title?: string;
}

const siteName = ${ JSON.stringify( context.siteName ) };
const { title } = Astro.props;
---

<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>{ title ? title + ' – ' + siteName : siteName }</title>
	</head>
	<body>
		<header class="site-header"><a class="site-title" href="/">{ siteName }</a></header>
		<main class="container">
			<slot />
		</main>
		<footer class="site-footer"><span>Content from WordPress, built with Astro.</span></footer>
	</body>
</html>
`;
}

const INDEX_ASTRO = `---
import Layout from '../layouts/Layout.astro';
import { featuredImage, formatDate, getPosts, type WPPost } from '../lib/wordpress';

let posts: WPPost[] = [];
let error = '';
try {
	posts = await getPosts();
} catch ( e ) {
	error = e instanceof Error ? e.message : String( e );
}
---

<Layout>
	{ error && <p class="notice">Could not load posts from WordPress. Is the site running? ({ error })</p> }
	{ ! error && posts.length === 0 && <p class="notice">No posts yet. Publish one in WordPress and reload.</p> }
	<ul class="posts">
		{
			posts.map( ( post ) => {
				const image = featuredImage( post );
				return (
					<li class="post-card">
						{ image && <img class="featured" src={ image.src } alt={ image.alt } /> }
						<h2><a href={ '/posts/' + post.slug } set:html={ post.title.rendered } /></h2>
						<div class="meta">{ formatDate( post.date ) }</div>
						<div class="excerpt" set:html={ post.excerpt.rendered } />
					</li>
				);
			} )
		}
	</ul>
</Layout>
`;

const POST_ASTRO = `---
import Layout from '../../layouts/Layout.astro';
import { featuredImage, formatDate, getPostBySlug, getPosts } from '../../lib/wordpress';

export async function getStaticPaths() {
	const posts = await getPosts( 100 );
	return posts.map( ( post ) => ( { params: { slug: post.slug } } ) );
}

const post = await getPostBySlug( Astro.params.slug ?? '' );
if ( ! post ) {
	return Astro.redirect( '/' );
}
const image = featuredImage( post );
---

<Layout title={ post.title.rendered.replace( /<[^>]+>/g, '' ) }>
	<article>
		{ image && <img class="featured" src={ image.src } alt={ image.alt } /> }
		<h1 set:html={ post.title.rendered } />
		<div class="meta">{ formatDate( post.date ) }</div>
		<div class="content" set:html={ post.content.rendered } />
		<p><a href="/">← All posts</a></p>
	</article>
</Layout>
`;

const PAGE_ASTRO = `---
import Layout from '../layouts/Layout.astro';
import { getPageBySlug, getPages } from '../lib/wordpress';

export async function getStaticPaths() {
	const pages = await getPages();
	return pages.map( ( page ) => ( { params: { slug: page.slug } } ) );
}

const page = await getPageBySlug( Astro.params.slug ?? '' );
if ( ! page ) {
	return Astro.redirect( '/' );
}
---

<Layout title={ page.title.rendered.replace( /<[^>]+>/g, '' ) }>
	<article>
		<h1 set:html={ page.title.rendered } />
		<div class="content" set:html={ page.content.rendered } />
	</article>
</Layout>
`;

function readme( context: FrontendTemplateContext ): string {
	return `# ${ context.siteName } frontend (Astro)

An [Astro](https://astro.build) site that reads its content from a local WordPress site over the REST API. WordPress Studio created it next to the WordPress install and runs \`npm run dev\` for you.

## Run it

\`\`\`sh
npm install
npm run dev
\`\`\`

Studio starts the dev server on the port in \`.env.local\` (\`PORT\`) whenever the site starts. In development every request is rendered fresh, so content you publish in WordPress shows on reload.

## Environment

Studio writes \`.env.local\` with:

- \`WORDPRESS_URL\`: the WordPress site (${ context.wordpressUrl }). \`src/lib/wordpress.ts\` reads it.
- \`WORDPRESS_HOSTNAME\`: its hostname.
- \`WORDPRESS_APPLICATION_USER\` / \`WORDPRESS_APPLICATION_PASSWORD\`: credentials for reading drafts. Server-side only; never rename them with a \`PUBLIC_\` prefix.
- \`STUDIO_PREVIEW_SECRET\`, \`STUDIO_REVALIDATE_SECRET\`: for previews and revalidation.
- \`PORT\`: the dev server port.

## Previews and revalidation

WordPress links to this site: posts at \`/posts/<slug>\`, pages at \`/<slug>\`. Its Preview button opens \`/api/draft?secret=…&id=…&type=…\`, and publishing POSTs to \`/api/revalidate\`.

This template uses Astro's default static output, which has no server routes, so neither endpoint exists yet: previews show a 404, and revalidation is unnecessary because \`astro dev\` renders on every request and \`astro build\` rebuilds everything.

TODO: to support previews, switch to \`output: 'server'\` with an adapter (for example \`@astrojs/node\`) and add \`src/pages/api/draft.ts\` that compares \`secret\` with \`STUDIO_PREVIEW_SECRET\`, then renders the post from \`getDraft( id, type )\` in \`src/lib/wordpress.ts\`.
`;
}

export function getAstroTemplate( context: FrontendTemplateContext ): FrontendTemplateFiles {
	return {
		'package.json': packageJson( context ),
		'astro.config.mjs': ASTRO_CONFIG,
		'tsconfig.json': TSCONFIG,
		'src/env.d.ts': ENV_D_TS,
		'src/lib/wordpress.ts': WORDPRESS_TS,
		'src/layouts/Layout.astro': layoutAstro( context ),
		'src/styles/global.css': BASE_CSS,
		'src/pages/index.astro': INDEX_ASTRO,
		'src/pages/posts/[slug].astro': POST_ASTRO,
		'src/pages/[slug].astro': PAGE_ASTRO,
		'.gitignore': GITIGNORE,
		'README.md': readme( context ),
		'AGENTS.md': getAgentsMd( context, {
			stack: 'It is an Astro 5 site with static output.',
			run: 'Run: `npm run dev` (Studio runs it on the frontend port when the site starts).',
			structure: [
				'`src/lib/wordpress.ts`: the REST client (`getPosts`, `getPostBySlug`, `getPages`, `getPageBySlug`, `getDraft`). Uses `_embed` for featured images.',
				'`src/pages/index.astro`: the post list.',
				'`src/pages/posts/[slug].astro`: a post. `src/pages/[slug].astro`: a page.',
				'`src/layouts/Layout.astro` and `src/styles/global.css`: the shell and styles.',
			],
			previews:
				'Static output has no server routes, so `/api/draft` and `/api/revalidate` do not exist yet (see README.md for how to add previews). `astro dev` renders every request, so published changes show on reload.',
		} ),
	};
}
