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
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden="true"
			{ ...props }
		>
			<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5" />
			{ state === 'docked' ? (
				<path d={ side === 'right' ? 'M9.75 2.25V13.75' : 'M6.25 2.25V13.75' } />
			) : (
				<rect
					x={ side === 'right' ? ( state === 'flyout' ? 8 : 10 ) : 4.5 }
					y="4.5"
					width={ state === 'flyout' ? 3.5 : 1.5 }
					height="7"
					rx={ state === 'flyout' ? 1.25 : 0.75 }
					fill="currentColor"
					stroke="none"
				/>
			) }
		</svg>
	);
}
