// Builds a WordPress Playground URL (a different origin) that renders a site
// client-side, Telex-style — no server in the sandbox. For a freshly created
// site this boots a clean WordPress so the preview honestly reflects the new,
// empty site (rather than canned demo content). Feeding the actual sandbox
// files into the preview is a later increment (needs a sandbox export).

export function buildPreviewUrl( siteName?: string ): string {
	const blueprint = {
		landingPage: '/',
		preferredVersions: { php: '8.3', wp: 'latest' },
		steps: [
			{
				step: 'installTheme',
				themeData: { resource: 'wordpress.org/themes', slug: 'twentytwentyfour' },
				options: { activate: true },
			},
			...( siteName ? [ { step: 'setSiteOptions', options: { blogname: siteName } } ] : [] ),
		],
	};
	// encodeURIComponent (not encodeURI) so `#`, `&`, `=` in the blueprint don't
	// corrupt the URL fragment.
	return 'https://playground.wordpress.net/#' + encodeURIComponent( JSON.stringify( blueprint ) );
}
