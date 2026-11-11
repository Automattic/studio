import type { ComponentProps } from 'react';

export function SidebarIcon( {
	state = 'docked',
	side = 'left',
	...props
}: ComponentProps< 'svg' > & {
	state?: 'closed' | 'flyout' | 'docked';
	side?: 'left' | 'right';
} ) {
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
				<path d={ side === 'right' ? 'M14 3V21' : 'M10 3V21' } />
			) : (
				<rect
					x={ side === 'right' ? ( state === 'flyout' ? 12 : 15.5 ) : 6.5 }
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
