import type { ComponentProps } from 'react';

export function CodeIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			{ ...props }
		>
			<path
				d="M10 20L14 4M18 8.00004L21.2929 11.2929C21.6834 11.6835 21.6834 12.3166 21.2929 12.7071L18 16M6 16L2.70711 12.7071C2.31658 12.3166 2.31658 11.6835 2.70711 11.2929L6 8.00004"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
