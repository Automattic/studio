import type { ComponentProps } from 'react';

export function ArrowLeftIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			{ ...props }
		>
			<path
				d="M10 5.75L3.75 12L10 18.25M4.5 12H20.25"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="square"
			/>
		</svg>
	);
}
