import type { ComponentProps } from 'react';

export function SyncIcon( { children, ...props }: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M19 18.584C20.7659 17.8124 22 16.0503 22 14C22 11.2386 19.7614 9 17 9C16.4547 9 15.9299 9.08728 15.4386 9.24864C14.3696 6.75042 11.8892 5 9 5C5.13401 5 2 8.13401 2 12C2 14.3787 3.18652 16.4804 5 17.7453"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				stroke="currentColor"
			/>
			{ children ?? (
				<path
					d="M14.5 16.5L12 14L9.5 16.5M12 20V14.75"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					stroke="currentColor"
				/>
			) }
		</svg>
	);
}
