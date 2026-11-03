import type { ComponentProps } from 'react';

export function FullscreenIcon( {
	inward = false,
	...props
}: ComponentProps< 'svg' > & { inward?: boolean } ) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M12 6C12 5.44772 12.4477 5 13 5H17C18.1046 5 19 5.89543 19 7V11C19 11.5523 18.5523 12 18 12C17.4477 12 17 11.5523 17 11V7H13C12.4477 7 12 6.55228 12 6Z"
				fillRule="evenodd"
				clipRule="evenodd"
				fill="currentColor"
				transform={ inward ? 'translate(1 -1) rotate(180 15.5 8.5)' : undefined }
			/>
			<path
				d="M6 12C6.55228 12 7 12.4477 7 13V17H11C11.5523 17 12 17.4477 12 18C12 18.5523 11.5523 19 11 19H7C5.89543 19 5 18.1046 5 17V13C5 12.4477 5.44772 12 6 12Z"
				fillRule="evenodd"
				clipRule="evenodd"
				fill="currentColor"
				transform={ inward ? 'translate(-1 1) rotate(180 8.5 15.5)' : undefined }
			/>
		</svg>
	);
}
