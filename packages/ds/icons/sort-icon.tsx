import type { ComponentProps } from 'react';

export function SortIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="-1.5 -1.5 27 27"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.25"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{ ...props }
		>
			<path d="M22 7H2 M19 12H5 M16 17H8" vectorEffect="non-scaling-stroke" />
		</svg>
	);
}
