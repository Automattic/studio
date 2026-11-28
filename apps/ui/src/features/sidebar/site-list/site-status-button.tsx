import {
	Button,
	IconButton,
	Menu,
	Spinner,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@studio/ds';
import { EllipsisVerticalIcon } from '@studio/ds/icons';
import { __, sprintf } from '@wordpress/i18n';
import { useSiteLifecycleState } from '@/data/use-site-lifecycle-state';
import { SiteMenuItems, type SiteActions } from '@/features/sites';
import { SidebarRowIcon } from './sidebar-row-icon';
import { getSiteStatus, getSiteStatusName } from './site-status';
import styles from './style.module.css';

export function SiteStatusButton( {
	actions,
	isStarting,
	isStopping,
}: {
	actions: SiteActions;
	isStarting: boolean;
	isStopping: boolean;
} ) {
	const { site } = actions;
	const {
		activity,
		isSyncPending,
		operation,
		stoppingStart,
		canStopStart,
		visuallyStopped,
		visualBusy,
		visualRunning,
		disabled,
	} = useSiteLifecycleState( site, isStarting, isStopping );
	const status = getSiteStatus( site, isStarting, isStopping, operation );
	const statusName = isSyncPending
		? activity?.direction === 'import'
			? __( 'Importing backup' )
			: __( 'Syncing live site' )
		: stoppingStart
		? __( 'Stopping' )
		: getSiteStatusName( {
				running: site.running,
				starting: isStarting,
				stopping: isStopping,
				operation,
		  } );
	const label = sprintf(
		visualRunning || canStopStart ? __( 'Stop %s' ) : __( 'Start %s' ),
		site.name
	);

	if ( site.running && ! actions.busy && ! isSyncPending ) {
		return (
			<Menu.Root modal={ false }>
				<Menu.Trigger
					render={
						<IconButton
							variant="muted-ghost"
							size="icon-sm"
							icon={ <EllipsisVerticalIcon /> }
							label={ sprintf( __( 'Actions for %s' ), site.name ) }
							tooltipLabel={ __( 'Site menu' ) }
							data-state="running"
							{ ...actions.shortcuts }
						/>
					}
				/>
				<Menu.Popup side="bottom" align="start" { ...actions.shortcuts }>
					<SiteMenuItems actions={ actions } showChatActions={ false } />
				</Menu.Popup>
			</Menu.Root>
		);
	}

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						className={ styles.statusButton }
						variant="muted-ghost"
						size="icon-sm"
						aria-label={ visualBusy && ! canStopStart ? statusName : label }
						aria-busy={ visualBusy || undefined }
						disabled={ disabled }
						focusableWhenDisabled
						data-state={ visuallyStopped ? 'stopped' : status }
						onClick={ canStopStart ? () => actions.stop( [ site ] ) : actions.toggleRunning }
					>
						{ visualBusy ? (
							<>
								<Spinner
									aria-hidden="true"
									className={ canStopStart ? styles.startSpinner : undefined }
								/>
								{ canStopStart && (
									<SidebarRowIcon glyph="stop" className={ styles.cancelStartIcon } />
								) }
							</>
						) : visualRunning ? (
							<SidebarRowIcon glyph="stop" />
						) : (
							<SidebarRowIcon glyph="start" />
						) }
					</Button>
				}
			/>
			<TooltipContent>
				{ visualBusy && ! canStopStart
					? statusName
					: visualRunning || canStopStart
					? __( 'Stop site' )
					: __( 'Start site' ) }
			</TooltipContent>
		</Tooltip>
	);
}
