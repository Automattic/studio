import type { ComponentProps } from 'react';

export function DisconnectIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M9 3V2M15 21V22M3 9H2M21 15H22M4.5 4.5L3.5 3.5M19.5 19.5L20.5 20.5M11 6L12.3787 4.62132C13.5503 3.44975 15.4497 3.44975 16.6213 4.62132L19.3787 7.37868C20.5503 8.55025 20.5503 10.4497 19.3787 11.6213L18 13M6 11L4.62132 12.3787C3.44975 13.5503 3.44975 15.4497 4.62132 16.6213L7.37868 19.3787C8.55025 20.5503 10.4497 20.5503 11.6213 19.3787L13 18"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
