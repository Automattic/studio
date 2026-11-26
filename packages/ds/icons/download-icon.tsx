import type { ComponentProps } from 'react';

export function DownloadIcon( {
	arrowDirection = 'down',
	...props
}: ComponentProps< 'svg' > & { arrowDirection?: 'up' | 'down' } ) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 256 256"
			fill="currentColor"
			stroke="currentColor"
			strokeWidth="4"
			strokeLinejoin="round"
			aria-hidden="true"
			{ ...props }
		>
			<path d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0Z" />
			<path
				d="M122.34,149.66a8,8,0,0,0,11.32,0l40-40a8,8,0,0,0-11.32-11.32L136,124.69V32a8,8,0,0,0-16,0v92.69L93.66,98.34a8,8,0,0,0-11.32,11.32Z"
				transform={ arrowDirection === 'up' ? 'translate(0 176) scale(1 -1)' : undefined }
			/>
		</svg>
	);
}
