import type { ComponentProps } from 'react';

export function HelpCenterIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M10 9.5V9C10 8.44772 10.4477 8 11 8H13C13.5523 8 14 8.44772 14 9V10C14 10.3148 13.8518 10.6111 13.6 10.8L12.4 11.7C12.1482 11.8889 12 12.1852 12 12.5V13M12 16V16.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
