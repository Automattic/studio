import { __, sprintf } from '@wordpress/i18n';
import { Tooltip } from 'src/components/tooltip';
import { cx } from 'src/lib/cx';
import type { StudioWorkspace, WorkspaceTargetId } from 'src/modules/workspaces/types';

type WorkspaceTargetSwitcherProps = {
	workspace: StudioWorkspace;
	selectedTargetId?: WorkspaceTargetId;
	onSelectTarget: ( targetId: WorkspaceTargetId ) => void;
};

const TARGET_ORDER: WorkspaceTargetId[] = [ 'production', 'staging', 'local' ];

function getTargetLabel( targetId: WorkspaceTargetId ) {
	if ( targetId === 'production' ) {
		return __( 'Production' );
	}

	if ( targetId === 'staging' ) {
		return __( 'Staging' );
	}

	return __( 'Local' );
}

function getMissingTargetTooltip( targetId: WorkspaceTargetId ) {
	return sprintf(
		// translators: %s is a workspace target label, such as "Production", "Staging", or "Local".
		__( '%s target is not available for this workspace.' ),
		getTargetLabel( targetId )
	);
}

function getSelectTargetLabel( workspace: StudioWorkspace, targetId: WorkspaceTargetId ) {
	const target = workspace.targets[ targetId ];
	const label = getTargetLabel( targetId );

	if ( ! target ) {
		return sprintf(
			// translators: %s is a workspace target label, such as "Production", "Staging", or "Local".
			__( '%s target unavailable' ),
			label
		);
	}

	if ( target.kind === 'local' ) {
		return target.site.running
			? sprintf(
					// translators: %s is the local site name.
					__( 'Select Local target: %s is running' ),
					target.site.name
			  )
			: sprintf(
					// translators: %s is the local site name.
					__( 'Select Local target: %s is stopped' ),
					target.site.name
			  );
	}

	return sprintf(
		// translators: 1: workspace target label, 2: remote site URL.
		__( 'Select %1$s target: %2$s' ),
		label,
		target.site.url
	);
}

function getDotClassName( targetId: WorkspaceTargetId ) {
	if ( targetId === 'production' ) {
		return 'bg-frame-theme';
	}

	if ( targetId === 'staging' ) {
		return 'bg-a8c-blue-50';
	}

	return 'bg-a8c-gray-40';
}

export function WorkspaceTargetSwitcher( {
	workspace,
	selectedTargetId,
	onSelectTarget,
}: WorkspaceTargetSwitcherProps ) {
	return (
		<div
			className="flex flex-wrap items-center gap-2"
			role="group"
			aria-label={ __( 'Workspace targets' ) }
		>
			{ TARGET_ORDER.map( ( targetId ) => {
				const target = workspace.targets[ targetId ];
				const isSelected = selectedTargetId === targetId;
				const isAvailable = Boolean( target );
				const label = getTargetLabel( targetId );
				const tooltip = isAvailable ? undefined : getMissingTargetTooltip( targetId );

				return (
					<Tooltip
						key={ targetId }
						text={ tooltip ?? label }
						disabled={ isAvailable }
						placement="bottom-start"
					>
						<button
							type="button"
							aria-label={ getSelectTargetLabel( workspace, targetId ) }
							disabled={ ! isAvailable }
							onClick={ () => onSelectTarget( targetId ) }
							className={ cx(
								'inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme disabled:cursor-not-allowed disabled:opacity-60',
								isSelected
									? 'border-transparent bg-a8c-green-5 text-a8c-green-70'
									: 'border-transparent bg-frame-surface text-frame-text-secondary hover:text-frame-text',
								! isAvailable && 'border-dashed border-frame-border bg-transparent'
							) }
						>
							<span
								aria-hidden="true"
								className={ cx( 'h-1.5 w-1.5 rounded-full', getDotClassName( targetId ) ) }
							/>
							{ label }
						</button>
					</Tooltip>
				);
			} ) }
		</div>
	);
}
