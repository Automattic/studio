import { useThemeDetails } from 'src/hooks/use-theme-details';
import { cx } from 'src/lib/cx';

export function SiteIcon( {
	siteId,
	siteName,
	size = 16,
	className,
}: {
	siteId: string;
	siteName: string;
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

	return (
		<div
			className={ cx(
				'rounded-sm flex-shrink-0 bg-[#ffffff19] text-[#ffffffaa] flex items-center justify-center font-medium leading-none',
				className
			) }
			style={ { width: size, height: size, fontSize: size * 0.6 } }
		>
			{ siteName.charAt( 0 ).toUpperCase() }
		</div>
	);
}
