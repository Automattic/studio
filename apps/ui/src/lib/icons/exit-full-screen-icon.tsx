import type { ComponentProps } from 'react';

export function ExitFullScreenIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M20 16H19C17.3431 16 16 17.3431 16 19V20M4 16H5C6.65685 16 8 17.3431 8 19V20M8 4V5C8 6.65685 6.65685 8 5 8H4M20 8H19C17.3431 8 16 6.65685 16 5V4"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
