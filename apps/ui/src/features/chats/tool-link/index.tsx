import { previewTabsKey, usePreviewTabs } from '@/data/preview-tabs';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';
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
	const { add } = usePreviewTabs( previewTabsKey( preview?.siteId ?? '' ), preview?.path );
	const open = () => {
		if ( ! preview?.siteId ) return;
		add( path );
		preview.updatePath( path );
		preview.setOpen( true );
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
