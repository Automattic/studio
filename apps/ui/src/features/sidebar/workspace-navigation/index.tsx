import { __ } from '@wordpress/i18n';
import { useWorkspaceHistory } from '@/features/sidebar/use-workspace-history';
import { ArrowLeftIcon, ArrowRightIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import styles from './style.module.css';

export function WorkspaceNavigation( { hidden = false }: { hidden?: boolean } ) {
	const history = useWorkspaceHistory();
	if ( hidden || ( ! history.canGoBack && ! history.canGoForward ) ) return null;
	return (
		<span className={ styles.root } role="group" aria-label={ __( 'Workspace navigation' ) }>
			<IconButton
				variant="muted-ghost"
				size="icon-sm"
				icon={ <ArrowLeftIcon /> }
				label={ __( 'Back' ) }
				tooltipSide="bottom"
				disabled={ ! history.canGoBack }
				onClick={ history.goBack }
			/>
			<IconButton
				variant="muted-ghost"
				size="icon-sm"
				icon={ <ArrowRightIcon /> }
				label={ __( 'Forward' ) }
				tooltipSide="bottom"
				disabled={ ! history.canGoForward }
				onClick={ history.goForward }
			/>
		</span>
	);
}
