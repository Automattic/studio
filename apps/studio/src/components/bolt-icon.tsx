// Lightning-bolt glyph used by `RemoteSessionIndicator`. `@wordpress/icons`
// doesn't ship a bolt (332 icons scanned at the time of writing), so we
// inline an SVG. Filled silhouette with rounded corners (matched to the rest
// of the top-bar icons), tucked into a ~14px-tall bounding box so the visible
// height aligns with the cog/help glyphs. The stroke shares the path so the
// corners read as soft instead of sharp.
export default (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
		<path
			d="M6.25 13L13.5 5L12 11H17.75L10.5 19L12 13Z"
			fill="currentColor"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinejoin="round"
			strokeLinecap="round"
		/>
	</svg>
);
