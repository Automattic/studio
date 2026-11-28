import { Icon } from './icon';
import type { ComponentProps } from 'react';

export function SmartphoneIcon( props: ComponentProps< 'svg' > ) {
	return (
		<Icon { ...props }>
			<rect x="6" y="2" width="12" height="20" rx="2" />
			<path d="M12 18H12.01" />
		</Icon>
	);
}
