import { __, sprintf } from '@wordpress/i18n';
import { Tooltip } from 'src/components/tooltip';
import { cx } from 'src/lib/cx';
import type { StudioWorkspace, WorkspaceTargetId } from 'src/modules/workspaces/types';

type WorkspaceTargetIndicatorsProps = {
	workspace: StudioWorkspace;
};

type Indicator = {
	targetId: WorkspaceTargetId;
	label: string;
	ariaLabel: string;
	dotClassName: string;
};

export function WorkspaceTargetIndicators( { workspace }: WorkspaceTargetIndicatorsProps ) {
	const indicators: Indicator[] = [];

	if ( workspace.targets.production ) {
		indicators.push( {
			targetId: 'production',
			label: __( 'Production' ),
			ariaLabel: sprintf(
				// translators: %s is the production site URL.
				__( 'Production target: %s' ),
				workspace.targets.production.site.url
			),
			dotClassName: 'bg-frame-theme',
		} );
	}

	if ( workspace.targets.staging ) {
		indicators.push( {
			targetId: 'staging',
			label: __( 'Staging' ),
			ariaLabel: sprintf(
				// translators: %s is the staging site URL.
				__( 'Staging target: %s' ),
				workspace.targets.staging.site.url
			),
			dotClassName: 'bg-a8c-blue-20',
		} );
	}

	if ( workspace.targets.local ) {
		const localSite = workspace.targets.local.site;
		indicators.push( {
			targetId: 'local',
			label: __( 'Local' ),
			ariaLabel: localSite.running
				? sprintf(
						// translators: %s is the local site name.
						__( 'Local target: %s is running' ),
						localSite.name
				  )
				: sprintf(
						// translators: %s is the local site name.
						__( 'Local target: %s is stopped' ),
						localSite.name
				  ),
			dotClassName: localSite.running ? 'bg-a8c-green-20' : 'bg-a8c-gray-500',
		} );
	}

	if ( indicators.length === 0 ) {
		return null;
	}

	const groupLabel = sprintf(
		// translators: %s is a comma-separated list of workspace targets, such as "Production, Staging, Local".
		__( 'Workspace targets: %s' ),
		indicators.map( ( indicator ) => indicator.label ).join( ', ' )
	);

	return (
		<div
			role="group"
			aria-label={ groupLabel }
			className="me-1 flex h-8 shrink-0 items-center gap-1"
		>
			{ indicators.map( ( indicator ) => (
				<Tooltip key={ indicator.targetId } text={ indicator.label }>
					<span
						role="img"
						aria-label={ indicator.ariaLabel }
						className={ cx(
							'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-a8c-gray-40 bg-transparent opacity-75',
							indicator.targetId === 'local' &&
								workspace.targets.local?.site.running &&
								'opacity-100'
						) }
					>
						<span
							aria-hidden="true"
							className={ cx( 'h-1.5 w-1.5 rounded-full', indicator.dotClassName ) }
						/>
					</span>
				</Tooltip>
			) ) }
		</div>
	);
}
