import { SidebarIcon } from './sidebar-icon';
import type { ComponentProps } from 'react';

export function SplitViewIcon( props: ComponentProps< 'svg' > ) {
	return <SidebarIcon side="right" { ...props } />;
}
