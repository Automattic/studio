import type { ComponentProps } from 'react';

export function SplitViewIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
			<path d="M11 3H17A4 4 0 0 1 21 7V17A4 4 0 0 1 17 21H11Z" fill="currentColor" />
		</svg>
	);
}
