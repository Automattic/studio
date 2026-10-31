import type { ComponentProps } from 'react';

export function CollapseIcon( props: ComponentProps< 'svg' > ) {
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
				d="M20 10H14V4M14 10L20.25 3.75M4 14H10V20M10 14L3.75 20.25"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				stroke="currentColor"
			/>
		</svg>
	);
}
