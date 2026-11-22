import type { ComponentProps } from 'react';

export function ChevronRightIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 256 256" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M104 68L164 128L104 188"
				stroke="currentColor"
				strokeWidth="20"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
