import { Icon } from './icon';
import type { ComponentProps } from 'react';

export function ChecklistIcon( props: ComponentProps< 'svg' > ) {
	return (
		<Icon strokeWidth="1.5" { ...props }>
			<path d="M2 5.5L3.21429 7L7.5 3" />
			<path d="M2 12.5L3.21429 14L7.5 10" />
			<path d="M2 19.5L3.21429 21L7.5 17" />
			<path d="M22 19L12 19" />
			<path d="M22 12L12 12" />
			<path d="M22 5L12 5" />
		</Icon>
	);
}
