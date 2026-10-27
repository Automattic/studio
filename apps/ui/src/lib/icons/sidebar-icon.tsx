import type { ComponentProps } from 'react';

export function SidebarIcon( {
	state = 'docked',
	...props
}: ComponentProps< 'svg' > & { state?: 'closed' | 'flyout' | 'docked' } ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
			{ ...props }
		>
			<rect x="3" y="3" width="18" height="18" rx="4" />
			{ state === 'docked' ? (
				<path d="M10 3V21" />
			) : (
				<rect
					x="6.5"
					y="6.5"
					width={ state === 'flyout' ? 5.5 : 2 }
					height="11"
					rx={ state === 'flyout' ? 2 : 1 }
					fill="currentColor"
					stroke="none"
				/>
			) }
		</svg>
	);
}
