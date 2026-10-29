import type { ComponentProps } from 'react';

export function ExpandIcon( props: ComponentProps< 'svg' > ) {
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
				d="M14 4H20V10M4 14V20H10M19.25 4.75L14 10M10 14L4.75 19.25"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				stroke="currentColor"
			/>
		</svg>
	);
}
