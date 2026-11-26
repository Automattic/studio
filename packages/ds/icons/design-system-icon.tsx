import type { ComponentProps } from 'react';

export function DesignSystemIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M12 3L14.75 5.75L12 8.5L9.25 5.75ZM12 15.5L14.75 18.25L12 21L9.25 18.25ZM5.75 9.25L8.5 12L5.75 14.75L3 12ZM18.25 9.25L21 12L18.25 14.75L15.5 12Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
