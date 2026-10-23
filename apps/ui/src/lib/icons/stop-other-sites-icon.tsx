import type { ComponentProps } from 'react';

export function StopOtherSitesIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
			<path
				d="M9.5 10.5C9.5 9.94772 9.94772 9.5 10.5 9.5H13.5C14.0523 9.5 14.5 9.94772 14.5 10.5V13.5C14.5 14.0523 14.0523 14.5 13.5 14.5H10.5C9.94772 14.5 9.5 14.0523 9.5 13.5V10.5Z"
				fill="currentColor"
			/>
		</svg>
	);
}
