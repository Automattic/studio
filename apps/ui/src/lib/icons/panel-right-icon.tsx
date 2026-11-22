import { SidebarIcon } from './sidebar-icon';
import type { ComponentProps } from 'react';

export function PanelRightIcon( props: ComponentProps< 'svg' > ) {
	return <SidebarIcon side="right" { ...props } />;
}
