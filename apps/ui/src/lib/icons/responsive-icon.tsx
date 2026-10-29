import type { ComponentProps } from 'react';

export function ResponsiveIcon( props: ComponentProps< 'svg' > ) {
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
				d="M10 19H14M9 22H15C16.6569 22 18 20.6569 18 19V5C18 3.34315 16.6569 2 15 2H9C7.34315 2 6 3.34315 6 5V19C6 20.6569 7.34315 22 9 22Z"
				strokeWidth="2"
				strokeLinecap="round"
				stroke="currentColor"
			/>
		</svg>
	);
}
