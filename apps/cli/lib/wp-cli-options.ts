// LLMs sometimes emit en/em dashes (`‐porcelain`, `–color`); WP-CLI silently
// ignores them, so reject up-front and let the caller retry with ASCII hyphens.
export function getUnsupportedWpCliOptionMessage( args: string[] ): string | null {
	const unsupportedOption = args.find( ( arg ) => /^[‐-―]\S+/.test( arg ) );
	if ( ! unsupportedOption ) {
		return null;
	}
	return `Unsupported WP-CLI option "${ unsupportedOption }": use ASCII hyphens, for example "--porcelain", not a typographic dash.`;
}
