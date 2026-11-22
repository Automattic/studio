import type { ComponentProps } from 'react';

export function SelectIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M8.65732 20.0263L3.73967 5.6443C3.3363 4.4646 4.46461 3.3363 5.64431 3.73967L20.0263 8.65732C21.3302 9.10318 21.3934 10.9237 20.1235 11.4589L14.5904 13.7907C14.2297 13.9427 13.9427 14.2297 13.7907 14.5904L11.4589 20.1235C10.9237 21.3934 9.10318 21.3302 8.65732 20.0263Z"
				stroke="currentColor"
				strokeWidth="2.05556"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
