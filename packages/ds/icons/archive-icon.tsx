import { StrokeIcon } from './stroke-icon';
import type { ComponentProps } from 'react';

export function ArchiveIcon( props: ComponentProps< 'svg' > ) {
	return (
		<StrokeIcon viewBox="0 0 16 16" { ...props }>
			<path
				d="M3 5.5v5.25a2.75 2.75 0 0 0 2.75 2.75h4.5A2.75 2.75 0 0 0 13 10.75V5.5 M6.5 8.5h3 M3 2.5h10a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1Z"
				vectorEffect="non-scaling-stroke"
			/>
		</StrokeIcon>
	);
}
