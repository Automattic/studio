import type { ComponentProps } from 'react';

export function MailIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M3.75 5.75H20.25V18.25H3.75V5.75ZM4.75 7L12 12.5L19.25 7"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="square"
			/>
		</svg>
	);
}
