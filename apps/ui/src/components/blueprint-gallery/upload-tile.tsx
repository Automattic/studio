import styles from './style.module.css';

/**
 * Stands in for the artwork the curated Blueprints carry, so the upload choice
 * reads as a peer of theirs rather than a bare icon.
 *
 * Deliberately fixed-color like those tiles (they are flat PNGs that don't
 * follow the theme), and it reuses their construction-guide motif — centre
 * cross, outer square, inner square — on blueprint navy. The outer square is
 * dashed here to mark this as the empty slot you fill.
 *
 * The viewBox and `slice` match the 1160x808 artwork so the crop lines up.
 */
export function UploadTile() {
	return (
		<div className={ styles.uploadTile }>
			{ /* data-keep-size opts out of the compact-density rule in index.css
			     that shrinks every svg to 16px; the frame above sets the size. */ }
			<svg
				width="100%"
				height="100%"
				viewBox="0 0 1160 808"
				preserveAspectRatio="xMidYMid slice"
				data-keep-size
				aria-hidden="true"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<linearGradient id="blueprint-upload-field" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stopColor="#26346E" />
						<stop offset="100%" stopColor="#161F49" />
					</linearGradient>
				</defs>
				<rect width="1160" height="808" fill="url(#blueprint-upload-field)" />
				{ /* Construction guides measured off the curated tiles so the four line
				     up: centre cross at 591.5/403.5, 548px outer square, 291.5px inner. */ }
				<g stroke="#FFF" strokeOpacity="0.22" strokeWidth="2" fill="none">
					<path d="M591.5 0V808M0 403.5H1160" />
					<rect x="445.75" y="257.75" width="291.5" height="291.5" />
					<circle cx="591.5" cy="403.5" r="145.75" />
					<rect x="317.5" y="129.5" width="548" height="548" strokeDasharray="14 12" />
				</g>
				{ /* Arrow out of an open tray, matched to the curated glyphs: stroke
				     22, and butt caps with mitre joins (the svg defaults, left
				     unset) so the ends and corners stay square like theirs rather
				     than rounded. */ }
				<g stroke="#FFF" strokeWidth="22" fill="none">
					<path d="M468.5 426.5V496.5H714.5V426.5" />
					<path d="M591.5 466V310.5M533.5 368.5L591.5 310.5L649.5 368.5" />
				</g>
			</svg>
		</div>
	);
}
