import type { ComponentProps } from 'react';

export function LoginIcon( {
	reverse = false,
	...props
}: ComponentProps< 'svg' > & { reverse?: boolean } ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M11.25 20H6C4.89543 20 4 19.1046 4 18V6C4 4.89543 4.89543 4 6 4H11.25M20 12L8.75 12M15.5 7.5L20 12L15.5 16.5"
				transform={ reverse ? 'translate(24 0) scale(-1 1)' : undefined }
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
