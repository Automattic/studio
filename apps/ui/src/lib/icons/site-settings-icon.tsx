import type { ComponentProps } from 'react';

export function SiteSettingsIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M17 14V4M17 14C18.6575 14 20 15.3425 20 17C20 18.6575 18.6575 20 17 20C15.3425 20 14 18.6575 14 17C14 15.3425 15.3425 14 17 14ZM7 20V12M7 12C5.3425 12 4 10.6575 4 9C4 7.3425 5.3425 6 7 6M7 12C8.6575 12 10 10.6575 10 9C10 7.3425 8.6575 6 7 6M7 6V4"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
