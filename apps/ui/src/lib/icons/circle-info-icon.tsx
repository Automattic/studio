import { Icon } from './icon';
import type { ComponentProps } from 'react';

export function CircleInfoIcon( props: ComponentProps< 'svg' > ) {
	return (
		<Icon { ...props }>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 11V16" />
			<circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
		</Icon>
	);
}
