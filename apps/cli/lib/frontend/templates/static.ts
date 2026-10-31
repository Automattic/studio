import {
	BASE_CSS,
	escapeHtml,
	getAgentsMd,
	GITIGNORE,
	toScriptLiteral,
	type FrontendTemplateContext,
	type FrontendTemplateFiles,
} from './shared';

// Plain JavaScript (no backticks), so it can live in this template literal.
const APP_SCRIPT = String.raw`(function () {
	var base = String( window.WORDPRESS_URL || '' ).replace( /\/$/, '' );
	var app = document.getElementById( 'app' );

	function api( path ) {
		return fetch( base + '/wp-json/wp/v2' + path ).then( function ( response ) {
			if ( ! response.ok ) {
				throw new Error( 'WordPress responded with ' + response.status );
			}
			return response.json();
		} );
	}

	function escapeAttribute( value ) {
		return String( value ).replace( /&/g, '&amp;' ).replace( /"/g, '&quot;' ).replace( /</g, '&lt;' );
	}

	function featuredImage( post ) {
		var media = post._embedded && post._embedded[ 'wp:featuredmedia' ];
		var image = media && media[ 0 ];
		if ( ! image || ! image.source_url ) {
			return '';
		}
		return '<img class="featured" src="' + escapeAttribute( image.source_url ) + '" alt="' + escapeAttribute( image.alt_text || '' ) + '">';
	}

	function formatDate( value ) {
		return new Date( value ).toLocaleDateString( undefined, { year: 'numeric', month: 'long', day: 'numeric' } );
	}

	function showError( error ) {
		app.innerHTML = '<p class="notice">Could not load content from WordPress at ' + escapeAttribute( base ) + '. Is the site running? (' + escapeAttribute( error.message ) + ')</p>';
	}

	function renderPosts() {
		api( '/posts?_embed&per_page=20' ).then( function ( posts ) {
			if ( ! posts.length ) {
				app.innerHTML = '<p class="notice">No posts yet. Publish one in WordPress and reload.</p>';
				return;
			}
			app.innerHTML = '<ul class="posts">' + posts.map( function ( post ) {
				var href = '/posts/' + encodeURIComponent( post.slug );
				return '<li class="post-card">' + featuredImage( post ) +
					'<h2><a href="' + href + '">' + post.title.rendered + '</a></h2>' +
					'<div class="meta">' + formatDate( post.date ) + '</div>' +
					'<div class="excerpt">' + post.excerpt.rendered + '</div></li>';
			} ).join( '' ) + '</ul>';
		} ).catch( showError );
	}

	function renderPost( slug ) {
		api( '/posts?_embed&slug=' + encodeURIComponent( slug ) ).then( function ( posts ) {
			var post = posts[ 0 ];
			if ( ! post ) {
				app.innerHTML = '<p class="notice">Post not found. <a href="/">See all posts</a></p>';
				return;
			}
			var title = document.createElement( 'textarea' );
			title.innerHTML = post.title.rendered;
			document.title = title.value + ' – ' + document.title;
			app.innerHTML = '<article>' + featuredImage( post ) +
				'<h1>' + post.title.rendered + '</h1>' +
				'<div class="meta">' + formatDate( post.date ) + '</div>' +
				'<div class="content">' + post.content.rendered + '</div>' +
				'<p><a href="/">← All posts</a></p></article>';
		} ).catch( showError );
	}

	var match = window.location.pathname.match( /^\/posts\/([^/]+)\/?$/ );
	var slug = match ? decodeURIComponent( match[ 1 ] ) : new URLSearchParams( window.location.search ).get( 'post' );
	if ( slug ) {
		renderPost( slug );
	} else {
		renderPosts();
	}
} )();`;

function indexHtml( context: FrontendTemplateContext ): string {
	const title = escapeHtml( context.siteName );
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${ title }</title>
		<style>
${ BASE_CSS }
		</style>
		<script>
			window.WORDPRESS_URL = ${ toScriptLiteral( context.wordpressUrl ) };
		</script>
		<script src="/studio.config.js"></script>
	</head>
	<body>
		<header class="site-header"><a class="site-title" href="/">${ title }</a></header>
		<main id="app" class="container"><p class="meta">Loading posts…</p></main>
		<footer class="site-footer"><span>Content from WordPress, served by WordPress Studio.</span></footer>
		<script>
${ APP_SCRIPT }
		</script>
	</body>
</html>
`;
}

function studioConfig( context: FrontendTemplateContext ): string {
	return `// The WordPress site this frontend reads from. Studio set it when it created
// the site; change it here (index.html keeps a fallback copy).
window.WORDPRESS_URL = ${ toScriptLiteral( context.wordpressUrl ) };
`;
}

export function getStaticTemplate( context: FrontendTemplateContext ): FrontendTemplateFiles {
	return {
		'public/index.html': indexHtml( context ),
		'public/studio.config.js': studioConfig( context ),
		'.gitignore': GITIGNORE,
		'AGENTS.md': getAgentsMd( context, {
			stack:
				'It is plain HTML, CSS and JavaScript with no build step: Studio serves `public/` as is.',
			run: 'Run: Studio serves `public/` on the frontend port; there is nothing to install.',
			structure: [
				'`public/index.html`: the page, its styles and the script that fetches posts from `/wp-json/wp/v2/posts?_embed` in the browser. It renders a single post at `/posts/<slug>` (when the server falls back to `index.html` for unknown paths) and at `?post=<slug>`.',
				'`public/studio.config.js`: sets `window.WORDPRESS_URL`. Static files cannot read `.env.local`, so the URL lives here.',
			],
			previews:
				'Everything runs in the browser, so only public content is available and changes show on reload. Previews (`/api/draft`) and revalidation (`/api/revalidate`) need a server-side frontend such as Next.js.',
			notes: [
				'Never put the application password from `.env.local` in `public/`: everything there is public.',
				'Add more pages as `.html` files in `public/`, or switch to a framework template if the site grows.',
			],
		} ),
	};
}
