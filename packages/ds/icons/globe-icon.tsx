import { StrokeIcon } from './stroke-icon';
import type { ComponentProps } from 'react';

export function GlobeIcon( props: ComponentProps< 'svg' > ) {
	return (
		<StrokeIcon viewBox="-1 -1 26 26" { ...props }>
			<path
				d="M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0Z M16 12a4 10 0 1 1-8 0 4 10 0 1 1 8 0Z M2 12h20"
				vectorEffect="non-scaling-stroke"
			/>
		</StrokeIcon>
	);
}
