import { StrokeIcon } from './stroke-icon';
import type { ComponentProps } from 'react';

export function SquarePenIcon( props: ComponentProps< 'svg' > ) {
	return (
		<StrokeIcon viewBox="0 0 16 16" { ...props }>
			<path
				d="M8 2H5.25a3 3 0 0 0-3 3v6.25a3 3 0 0 0 3 3h5.5a3 3 0 0 0 3-3V8 M6.25 10l.75-3 4.75-4.75a1.42 1.42 0 0 1 2 2L9 9Z"
				vectorEffect="non-scaling-stroke"
			/>
		</StrokeIcon>
	);
}
