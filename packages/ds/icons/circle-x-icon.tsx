import { Icon } from './icon';
import type { ComponentProps } from 'react';

export function CircleXIcon( props: ComponentProps< 'svg' > ) {
	return (
		<Icon { ...props }>
			<circle cx="12" cy="12" r="9" />
			<path d="M9 9L15 15M15 9L9 15" />
		</Icon>
	);
}
