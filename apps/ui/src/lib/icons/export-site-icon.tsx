import type { ComponentProps } from 'react';

export function ExportSiteIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M7.4 7.5H7.6M4 11V7C4 5.34315 5.34315 4 7 4H17C18.6569 4 20 5.34315 20 7V11M4 11V17C4 18.6569 5.34315 20 7 20H17C18.6569 20 20 18.6569 20 17V11M4 11H20M11 7.5H17M8 7.5C8 7.77614 7.77614 8 7.5 8C7.22386 8 7 7.77614 7 7.5C7 7.22386 7.22386 7 7.5 7C7.77614 7 8 7.22386 8 7.5Z"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
