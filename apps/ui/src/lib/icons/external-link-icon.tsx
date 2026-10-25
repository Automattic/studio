import type { ComponentProps } from 'react';

export function ExternalLinkIcon( props: ComponentProps< 'svg' > ) {
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
				d="M9 6H18V15M18 6L6.25 17.75"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
