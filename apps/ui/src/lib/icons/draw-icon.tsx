import type { ComponentProps } from 'react';

export function DrawIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M3 10.5C7.5 6 13.5 0.75 16.5 3.5C19.5 6.25 4.5 14.75 7 17C9.5 19.25 17.25 8.25 20 10.5C22.25 12.5 13.5 19 16.5 20.5C18 21.25 20 19.25 21 18"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
