import { StrokeIcon } from './stroke-icon';
import type { ComponentProps } from 'react';

export function SortIcon( props: ComponentProps< 'svg' > ) {
	return (
		<StrokeIcon viewBox="-1.5 -1.5 27 27" { ...props }>
			<path d="M22 7H2 M19 12H5 M16 17H8" vectorEffect="non-scaling-stroke" />
		</StrokeIcon>
	);
}
