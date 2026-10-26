import type { ComponentProps } from 'react';

export function PhpIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M10 9.5L8.20711 11.2929C7.81658 11.6834 7.81658 12.3166 8.20711 12.7071L10 14.5M14 9.5L15.7929 11.2929C16.1834 11.6834 16.1834 12.3166 15.7929 12.7071L14 14.5M7 20H17C18.6569 20 20 18.6569 20 17V7C20 5.34315 18.6569 4 17 4H7C5.34315 4 4 5.34315 4 7V17C4 18.6569 5.34315 20 7 20Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
