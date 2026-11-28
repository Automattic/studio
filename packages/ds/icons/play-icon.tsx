import { StrokeIcon } from './stroke-icon';
import type { ComponentProps } from 'react';

export function PlayIcon( {
	filled = false,
	...props
}: ComponentProps< 'svg' > & { filled?: boolean } ) {
	if ( ! filled ) {
		return (
			<StrokeIcon viewBox="0 0 16 16" { ...props }>
				<path
					d="M3.5 4c0-1.3 1.4-2.1 2.5-1.4l6.2 4c1 .65 1 2.15 0 2.8l-6.2 4c-1.1.7-2.5-.1-2.5-1.4Z"
					vectorEffect="non-scaling-stroke"
				/>
			</StrokeIcon>
		);
	}
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			{ ...props }
		>
			<path
				d="M17.7721 9.48786L9.88534 4.33957C7.8899 3.03699 5.24547 4.46875 5.24547 6.8517V17.1483C5.24547 19.5313 7.8899 20.963 9.88534 19.6604L17.7721 14.5121C19.5856 13.3283 19.5856 10.6717 17.7721 9.48786Z"
				fill="currentColor"
				stroke="none"
			/>
		</svg>
	);
}
