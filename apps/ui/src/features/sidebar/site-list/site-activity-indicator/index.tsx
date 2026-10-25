import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import styles from './style.module.css';

export type SiteRowActivity = 'idle' | 'sync' | 'import';

const ACTIVITY_EXIT_DURATION_MS = 180;

function SiteAgentActivityTooltip( {
	label,
	className,
	children,
}: {
	label: string;
	className?: string;
	children?: ReactNode;
} ) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						className={ clsx(
							styles.siteAgentActivity,
							styles.siteAgentActivityTooltipTrigger,
							className
						) }
						role="status"
						aria-label={ label }
					/>
				}
			>
				{ children }
			</TooltipTrigger>
			<TooltipContent>{ label }</TooltipContent>
		</Tooltip>
	);
}

export function SiteAgentActivityIndicator( { activity }: { activity: SiteRowActivity } ) {
	const [ exitingActivity, setExitingActivity ] = useState< SiteRowActivity >( 'idle' );

	useEffect( () => {
		if ( activity !== 'idle' ) {
			setExitingActivity( activity );
			return;
		}

		const timeout = window.setTimeout(
			() => setExitingActivity( 'idle' ),
			ACTIVITY_EXIT_DURATION_MS
		);
		return () => window.clearTimeout( timeout );
	}, [ activity ] );

	const renderedActivity = activity === 'idle' ? exitingActivity : activity;
	const isVisible = activity !== 'idle';
	const syncLabel = __( 'Syncing live site' );
	const importLabel = __( 'Importing backup' );

	return (
		<span
			className={ clsx(
				styles.siteAgentActivitySlot,
				isVisible && styles.siteAgentActivitySlotVisible
			) }
			aria-hidden={ isVisible ? undefined : 'true' }
		>
			{ renderedActivity === 'sync' || renderedActivity === 'import' ? (
				<SiteAgentActivityTooltip
					label={ renderedActivity === 'import' ? importLabel : syncLabel }
					className={ styles.siteAgentActivitySync }
				>
					<span className={ styles.siteAgentActivitySyncDots } aria-hidden="true">
						<span className={ styles.siteAgentActivitySyncDot } />
						<span className={ styles.siteAgentActivitySyncDot } />
						<span className={ styles.siteAgentActivitySyncDot } />
					</span>
				</SiteAgentActivityTooltip>
			) : null }
		</span>
	);
}
