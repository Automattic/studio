import { Icon } from './icon';
import type { ComponentProps } from 'react';

export function ReplyIcon( props: ComponentProps< 'svg' > ) {
	return (
		<Icon strokeWidth="1.5" { ...props }>
			<path d="M3.55 11.4H14.2c3.3 0 5.98 2.68 5.98 5.98" />
			<path d="M7.38 6.62L5.42 8.57c-1.33 1.34-2 2-2 2.83s.66 1.5 2 2.83l1.96 1.97" />
		</Icon>
	);
}
