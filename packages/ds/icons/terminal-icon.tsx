import type { ComponentProps } from 'react';

export function TerminalIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M4.29289 6.29289C4.68342 5.90237 5.31658 5.90237 5.70711 6.29289L10 10.5858C10.781 11.3668 10.781 12.6332 10 13.4142L5.70711 17.7071C5.31658 18.0976 4.68342 18.0976 4.29289 17.7071C3.90237 17.3166 3.90237 16.6834 4.29289 16.2929L8.58579 12L4.29289 7.70711C3.90237 7.31658 3.90237 6.68342 4.29289 6.29289ZM12 17C12 16.4477 12.4477 16 13 16H19C19.5523 16 20 16.4477 20 17C20 17.5523 19.5523 18 19 18H13C12.4477 18 12 17.5523 12 17Z"
				fill="currentColor"
			/>
		</svg>
	);
}
