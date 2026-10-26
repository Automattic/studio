import type { ComponentProps } from 'react';

export function McpIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M9 7H8C6.34315 7 5 8.34315 5 10V13C5 15.7614 7.23858 18 10 18H12M9 7V3M9 7H15M15 7H16C17.6569 7 19 8.34315 19 10V13C19 15.7614 16.7614 18 14 18H12M15 7V3M12 18V21"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
