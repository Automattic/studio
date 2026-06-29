import { __ } from '@wordpress/i18n';
import { Icon, plugins } from '@wordpress/icons';
import Button from 'src/components/button';
import workbenchStyles from '../development-workbench.module.css';
import type { ProjectOpenAction } from './types';
import type { DevelopmentProject } from '@studio/common/types/publishing';

type ProjectWorkbenchTitlebarProps = {
	project: DevelopmentProject;
	selectedPath: string | null;
	openButtons: ProjectOpenAction[];
	isRefreshing: boolean;
	onRefresh: () => void;
	onRemove: () => void;
};

export function ProjectWorkbenchTitlebar( {
	project,
	selectedPath,
	openButtons,
	isRefreshing,
	onRefresh,
	onRemove,
}: ProjectWorkbenchTitlebarProps ) {
	return (
		<header className={ workbenchStyles.titlebar }>
			<div className={ workbenchStyles.projectTitle }>
				<div className={ workbenchStyles.projectKicker }>
					<Icon icon={ plugins } size={ 18 } />
					<span>{ __( 'Plugin project' ) }</span>
				</div>
				<h1>{ project.name }</h1>
				<div className={ workbenchStyles.projectMeta }>
					<span>{ project.slug }</span>
					{ project.info?.version && <span>{ project.info.version }</span> }
					{ selectedPath && <span>{ selectedPath }</span> }
				</div>
			</div>
			<div className={ workbenchStyles.titleActions }>
				{ openButtons.map( ( action ) => (
					<Button
						key={ action.label }
						variant="secondary"
						icon={ action.icon }
						iconSize={ 18 }
						disabled={ action.disabled }
						onClick={ action.onClick }
					>
						{ action.label }
					</Button>
				) ) }
				<Button variant="secondary" onClick={ onRefresh } disabled={ isRefreshing }>
					{ isRefreshing ? __( 'Refreshing…' ) : __( 'Refresh' ) }
				</Button>
				<Button variant="secondary" isDestructive onClick={ onRemove }>
					{ __( 'Remove' ) }
				</Button>
			</div>
		</header>
	);
}
