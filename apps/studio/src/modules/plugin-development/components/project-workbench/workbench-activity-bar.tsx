import { __ } from '@wordpress/i18n';
import { Icon, archive, code, commentContent, tool } from '@wordpress/icons';
import { cx } from 'src/lib/cx';
import workbenchStyles from '../development-workbench.module.css';
import type { WorkbenchSidebarTab } from './types';

type WorkbenchActivityBarProps = {
	sidebarTab: WorkbenchSidebarTab;
	reviewPatchCount: number;
	onSelectSidebarTab: ( tab: WorkbenchSidebarTab ) => void;
};

export function WorkbenchActivityBar( {
	sidebarTab,
	reviewPatchCount,
	onSelectSidebarTab,
}: WorkbenchActivityBarProps ) {
	return (
		<nav className={ workbenchStyles.activityBar } aria-label={ __( 'Development tools' ) }>
			<button type="button" className={ workbenchStyles.activityButtonActive }>
				<Icon icon={ archive } size={ 20 } />
				<span>{ __( 'Files' ) }</span>
			</button>
			<button
				type="button"
				className={ cx(
					workbenchStyles.activityButton,
					sidebarTab === 'ai' && workbenchStyles.activityButtonActive
				) }
				onClick={ () => onSelectSidebarTab( 'ai' ) }
			>
				<Icon icon={ commentContent } size={ 20 } />
				<span>{ __( 'Studio Code' ) }</span>
			</button>
			<button
				type="button"
				className={ cx(
					workbenchStyles.activityButton,
					sidebarTab === 'releases' && workbenchStyles.activityButtonActive
				) }
				onClick={ () => onSelectSidebarTab( 'releases' ) }
			>
				<Icon icon={ tool } size={ 20 } />
				<span>{ __( 'Releases' ) }</span>
			</button>
			{ reviewPatchCount > 0 && (
				<button
					type="button"
					className={ cx(
						workbenchStyles.activityButton,
						sidebarTab === 'review' && workbenchStyles.activityButtonActive
					) }
					onClick={ () => onSelectSidebarTab( 'review' ) }
				>
					<Icon icon={ code } size={ 20 } />
					<span>{ __( 'Review' ) }</span>
				</button>
			) }
		</nav>
	);
}
