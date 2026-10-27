import type { ComponentProps } from 'react';

export function PlusIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M12 4V12M12 12V20M12 12H4M12 12H20"
				strokeWidth="2"
				strokeLinecap="round"
				stroke="currentColor"
			/>
		</svg>
	);
}
