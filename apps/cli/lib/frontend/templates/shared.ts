import { getFrontendUrl, type SiteFrontend } from '@studio/common/lib/site-frontend';

export interface FrontendTemplateContext {
	siteName: string;
	packageName: string;
	wordpressUrl: string;
	frontend: SiteFrontend;
}

// Paths relative to the frontend folder, mapped to their content.
export type FrontendTemplateFiles = Record< string, string >;

export function toPackageName( siteName: string ): string {
	const name = siteName
		.toLowerCase()
		.replace( /[^a-z0-9-]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, 60 );
	return name ? `${ name }-frontend` : 'studio-frontend';
}

export function escapeHtml( value: string ): string {
	return value
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' )
		.replace( /'/g, '&#39;' );
}

// A JSON literal that is also safe inside an inline <script>.
export function toScriptLiteral( value: unknown ): string {
	return JSON.stringify( value ).replace( /</g, '\\u003c' );
}

export const BASE_CSS = `:root {
	color-scheme: light dark;
	--background: #ffffff;
	--foreground: #1e1e1e;
	--muted: #6b6b6b;
	--border: #e6e6e6;
	--card: #fafafa;
	--accent: #3858e9;
	font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
}

@media (prefers-color-scheme: dark) {
	:root {
		--background: #121212;
		--foreground: #f0f0f0;
		--muted: #a3a3a3;
		--border: #2b2b2b;
		--card: #1b1b1b;
		--accent: #8196ff;
	}
}

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	background: var(--background);
	color: var(--foreground);
	line-height: 1.6;
}

a {
	color: var(--accent);
}

.site-header,
.site-footer {
	padding: 1.25rem 1rem;
}

.site-header {
	border-bottom: 1px solid var(--border);
}

.site-footer {
	border-top: 1px solid var(--border);
	color: var(--muted);
	font-size: 0.875rem;
}

.site-header > *,
.site-footer > * {
	display: block;
	max-width: 44rem;
	margin: 0 auto;
}

.site-title {
	color: inherit;
	font-weight: 600;
	font-size: 1.125rem;
	text-decoration: none;
}

.container {
	max-width: 44rem;
	margin: 0 auto;
	padding: 2rem 1rem 4rem;
}

.posts {
	display: grid;
	gap: 1.25rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.post-card {
	padding: 1.25rem;
	border: 1px solid var(--border);
	border-radius: 12px;
	background: var(--card);
}

.post-card h2 {
	margin: 0 0 0.25rem;
	font-size: 1.375rem;
	line-height: 1.3;
}

.post-card h2 a {
	color: inherit;
	text-decoration: none;
}

.post-card h2 a:hover {
	color: var(--accent);
}

.featured {
	display: block;
	width: 100%;
	height: auto;
	margin-bottom: 1rem;
	border-radius: 8px;
}

.meta {
	color: var(--muted);
	font-size: 0.875rem;
}

.excerpt p {
	margin: 0.5rem 0 0;
}

article h1 {
	margin: 0 0 0.5rem;
	font-size: 2.25rem;
	line-height: 1.2;
}

.content img {
	max-width: 100%;
	height: auto;
}

.notice {
	padding: 0.75rem 1rem;
	border: 1px solid var(--border);
	border-radius: 8px;
	background: var(--card);
}
`;

export const GITIGNORE = `node_modules/
dist/
.astro/
.next/
out/
.env*.local
.DS_Store
`;

function getEnvContract( context: FrontendTemplateContext ): string {
	const lines = [
		`- \`WORDPRESS_URL\`: the WordPress site (${ context.wordpressUrl }).`,
		'- `WORDPRESS_HOSTNAME`: its hostname, for image allow-lists.',
	];
	if ( context.frontend.api === 'graphql' ) {
		lines.push( '- `WORDPRESS_GRAPHQL_URL`: the WPGraphQL endpoint.' );
	}
	lines.push(
		'- `WORDPRESS_APPLICATION_USER` and `WORDPRESS_APPLICATION_PASSWORD`: an Editor-role user and its application password, for reading drafts with HTTP Basic auth. Server-side only: never expose them under a public prefix.',
		'- `STUDIO_PREVIEW_SECRET`: checked by the draft route that WordPress previews open.',
		'- `STUDIO_REVALIDATE_SECRET`: sent by WordPress in the `X-Studio-Revalidate-Secret` header when content changes.',
		'- `PORT`: the port Studio runs this frontend on.'
	);
	return lines.join( '\n' );
}

const PREVIEWS_AND_REVALIDATION =
	'WordPress opens previews at `/api/draft?secret=…&id=…&type=…&status=…`; the route checks the secret, turns on draft mode and shows the draft, fetched with the application password. When a post is published, updated or unpublished, WordPress POSTs `{ "paths": [...], "tags": [...] }` to `/api/revalidate` with the revalidate secret in the `X-Studio-Revalidate-Secret` header.';

export function getAgentsMd(
	context: FrontendTemplateContext,
	details: {
		stack: string;
		run: string;
		structure: string[];
		previews?: string;
		notes?: string[];
	}
): string {
	const notes = details.notes?.length
		? `\n## Notes\n\n${ details.notes.map( ( note ) => `- ${ note }` ).join( '\n' ) }\n`
		: '';
	return `# ${ context.siteName } frontend

This is the frontend of a headless WordPress site managed by WordPress Studio. ${
		details.stack
	} It reads content from WordPress over the ${
		context.frontend.api === 'graphql' ? 'WPGraphQL and REST APIs' : 'REST API'
	}.

- WordPress backend: ${ context.wordpressUrl } (admin at ${ context.wordpressUrl }/wp-admin/)
- Frontend: ${ getFrontendUrl( context.frontend ) }
- ${ details.run }

The WordPress install lives in the sibling \`wordpress/\` folder. Change content in WordPress, not here; change how it looks and which data it shows here.

## Environment

Studio writes \`.env.local\` when it creates the site and passes the same variables to the dev server. Do not commit it.

${ getEnvContract( context ) }

## Links, previews and revalidation

View links in WordPress point here: posts at \`/posts/<slug>\`, pages at \`/<slug>\`. ${
		details.previews ?? PREVIEWS_AND_REVALIDATION
	}

## Structure

${ details.structure.map( ( item ) => `- ${ item }` ).join( '\n' ) }
${ notes }`;
}
