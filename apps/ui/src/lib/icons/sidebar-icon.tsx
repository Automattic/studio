import type { ComponentProps } from 'react';

export function SidebarIcon( {
	expanded,
	...props
}: ComponentProps< 'svg' > & { expanded: boolean } ) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
			{ ...props }
		>
			<rect x="3" y="3" width="18" height="18" rx="4" />
			<path
				d={ expanded ? 'M10 3V21' : 'M7.5 7.5V16.5' }
				strokeLinecap={ expanded ? 'butt' : 'round' }
			/>
		</svg>
	);
}
