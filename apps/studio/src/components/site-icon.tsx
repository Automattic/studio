import { WordPressLogoCircle } from 'src/components/wordpress-logo-circle';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { cx } from 'src/lib/cx';

const SITE_ICON_COLORS = [
	'#5B8A72', // sage
	'#7B6B8A', // lavender
	'#8A7B5B', // khaki
	'#5B7B8A', // steel
	'#8A5B6B', // mauve
	'#6B8A5B', // moss
	'#5B6B8A', // slate
	'#8A6B5B', // clay
];

/**
 * Simple hash of a string to a number, used for deterministic
 * color assignment for sites without an explicit iconColorIndex.
 */
function hashStringToIndex( str: string ): number {
	let hash = 0;
	for ( let i = 0; i < str.length; i++ ) {
		hash = ( hash * 31 + str.charCodeAt( i ) ) | 0;
	}
	return Math.abs( hash );
}

export function SiteIcon( {
	siteId,
	iconColorIndex,
	size = 16,
	className,
}: {
	siteId: string;
	iconColorIndex?: number;
	size?: number;
	className?: string;
} ) {
	const { siteIcons } = useThemeDetails();
	const iconData = siteIcons[ siteId ];

	if ( iconData ) {
		return (
			<img
				src={ iconData }
				width={ size }
				height={ size }
				alt=""
				className={ cx( 'rounded-sm flex-shrink-0', className ) }
			/>
		);
	}

	const colorIndex =
		typeof iconColorIndex === 'number' ? iconColorIndex : hashStringToIndex( siteId );
	const bgColor = SITE_ICON_COLORS[ colorIndex % SITE_ICON_COLORS.length ];

	return (
		<div
			className={ cx( 'rounded flex-shrink-0 flex items-center justify-center', className ) }
			style={ { width: size, height: size, backgroundColor: bgColor } }
		>
			<WordPressLogoCircle size={ Math.round( size * 0.55 ) } color="currentColor" />
		</div>
	);
}
