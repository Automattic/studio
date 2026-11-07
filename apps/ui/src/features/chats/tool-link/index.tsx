import { previewTabsKey, usePreviewTabs } from '@/data/preview-tabs';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';
import { useUserWorkspaceLayoutTransition } from '@/data/use-workspace-layout-tracks';
import { usePreviewOpenTracks } from '@/features/sites';
import { Button } from '@/lib/ui';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function ToolLink( {
	icon,
	children,
	path,
	...props
}: {
	icon: ReactNode;
	children: ReactNode;
	path: string;
	'aria-label'?: string;
} ) {
	const preview = useOptionalSessionPreviewUI();
	const runLayoutTransition = useUserWorkspaceLayoutTransition( preview?.siteId ?? undefined );
	const trackOpen = usePreviewOpenTracks();
	const { add } = usePreviewTabs( previewTabsKey( preview?.siteId ?? '' ), preview?.path );
	const open = () => {
		if ( ! preview?.siteId ) return;
		trackOpen( path );
		runLayoutTransition( () => {
			add( path );
			preview.updatePath( path );
			preview.setOpen( true );
		} );
	};
	return (
		<Button
			variant="unstyled"
			size="inline"
			className={ styles.toolLink }
			onClick={ open }
			{ ...props }
		>
			{ icon }
			{ children }
		</Button>
	);
}
