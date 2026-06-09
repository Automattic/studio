import { __ } from '@wordpress/i18n';
import { chevronDownSmall } from '@wordpress/icons';
import { Button, Icon, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import { SiteIcon } from '@/components/site-icon';
import styles from './dropdown-trigger.module.css';
import type { ComponentProps, ElementRef } from 'react';

export type SiteStatus = 'running' | 'stopped' | 'transitioning';

type Props = Omit< ComponentProps< typeof Button >, 'children' > & {
	siteName: string;
	siteUrl: string;
	status: SiteStatus;
	statusLabel: string;
	environment: 'local' | 'live';
	showSiteIcon?: boolean;
	siteIconSeed?: string;
	siteIconImage?: string | null;
	shortcut?: {
		displayShortcut: string;
		ariaKeyShortcut: string;
	};
};

export const DropdownTrigger = forwardRef< ElementRef< typeof Button >, Props >(
	function DropdownTrigger(
		{
			siteName,
			siteUrl,
			status,
			statusLabel,
			environment,
			showSiteIcon = false,
			siteIconSeed,
			siteIconImage,
			shortcut,
			className,
			...props
		},
		ref
	) {
		// In live mode the local server's running/stopped status is irrelevant
		// to what the agent targets; use a dedicated dot color so the trigger
		// still reflects the active target.
		const isLive = environment === 'live';
		const dotClass = environment === 'live' ? styles.dot_live : styles[ `dot_${ status }` ];
		const dotLabel = isLive ? __( 'Live site' ) : statusLabel;
		const tooltipLabel = __( 'Open site menu' );
		return (
			<Tooltip.Provider delay={ 0 }>
				<Tooltip.Root>
					<Tooltip.Trigger
						ref={ ref }
						render={
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								aria-keyshortcuts={ shortcut?.ariaKeyShortcut }
								{ ...props }
							/>
						}
						className={ clsx( styles.trigger, className ) }
					>
						{ showSiteIcon ? (
							<SiteIcon
								className={ styles.siteIcon }
								seed={ siteIconSeed ?? `${ siteName }:${ siteUrl }` }
								imageSrc={ siteIconImage }
							/>
						) : null }
						<span
							className={ clsx( styles.statusBadge, {
								[ styles.statusBadge_live ]: isLive,
								[ styles.statusBadge_running ]: status === 'running' && ! isLive,
								[ styles.statusBadge_stopped ]: status === 'stopped' && ! isLive,
								[ styles.statusBadge_transitioning ]: status === 'transitioning' && ! isLive,
							} ) }
							role="img"
							aria-label={ dotLabel }
							title={ dotLabel }
						>
							<span className={ clsx( styles.dot, dotClass ) } aria-hidden="true" />
							{ isLive ? <span className={ styles.statusLabel }>{ __( 'Live' ) }</span> : null }
						</span>
						<span className={ styles.identity }>
							<span className={ styles.site }>{ siteName }</span>
							<span className={ styles.url }>{ siteUrl }</span>
						</span>
						<Icon className={ styles.chevron } icon={ chevronDownSmall } />
					</Tooltip.Trigger>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
						{ tooltipLabel }
						{ shortcut ? (
							<>
								{ ' ' }
								<span aria-hidden="true">{ shortcut.displayShortcut }</span>
							</>
						) : null }
					</Tooltip.Popup>
				</Tooltip.Root>
			</Tooltip.Provider>
		);
	}
);
