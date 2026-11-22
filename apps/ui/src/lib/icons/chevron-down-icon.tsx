import type { ComponentProps } from 'react';

export function ChevronDownIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 256 256" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M68 104L128 164L188 104"
				stroke="currentColor"
				strokeWidth="20"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
