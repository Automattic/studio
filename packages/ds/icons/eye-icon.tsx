import { StrokeIcon } from './stroke-icon';
import type { ComponentProps } from 'react';

export function EyeIcon( props: ComponentProps< 'svg' > ) {
	return (
		<StrokeIcon { ...props }>
			<path
				vectorEffect="non-scaling-stroke"
				d="M12 4C7.81811 4 4.97196 6.49956 3.27489 8.70433C2.42496 9.80853 2 10.3606 2 12C2 13.6394 2.42496 14.1915 3.27489 15.2957C4.97196 17.5004 7.81811 20 12 20C16.1819 20 19.028 17.5004 20.7251 15.2957C21.575 14.1915 22 13.6394 22 12C22 10.3606 21.575 9.80853 20.7251 8.70433C19.028 6.49956 16.1819 4 12 4Z"
			/>
			<path
				vectorEffect="non-scaling-stroke"
				d="M15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z"
			/>
		</StrokeIcon>
	);
}
