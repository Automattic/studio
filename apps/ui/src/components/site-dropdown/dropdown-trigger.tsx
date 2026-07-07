import { __ } from '@wordpress/i18n';
import { chevronDownSmall } from '@wordpress/icons';
import { Button, Icon, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import { SiteIcon } from '@/components/site-icon';
import styles from './dropdown-trigger.module.css';
import type { TriggerSecondaryTone } from './trigger-secondary';
import type { ComponentProps, ElementRef } from 'react';

export type SiteStatus = 'running' | 'stopped' | 'transitioning';

type Props = Omit< ComponentProps< typeof Button >, 'children' > & {
	siteName: string;
	siteUrl: string;
	status: SiteStatus;
	statusLabel: string;
	environment: 'local' | 'live';
	secondaryLabel: string;
	secondaryTone?: TriggerSecondaryTone;
	showSiteIcon?: boolean;
	showStatus?: boolean;
	siteIconSeed?: string;
	siteIconImage?: string | null;
};

export const DropdownTrigger = forwardRef< ElementRef< typeof Button >, Props >(
	function DropdownTrigger(
		{
			siteName,
			siteUrl,
			status,
			statusLabel,
			environment,
			secondaryLabel,
			secondaryTone = 'neutral',
			showSiteIcon = false,
			showStatus = true,
			siteIconSeed,
			siteIconImage,
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
		const statusClass =
			environment === 'live' ? styles.statusBadge_live : styles[ `statusBadge_${ status }` ];
		const dotLabel = isLive ? __( 'Live site' ) : statusLabel;
		const statusBadge = showStatus ? (
			<span
				className={ clsx(
					styles.statusBadge,
					showSiteIcon && styles.statusBadge_overlay,
					statusClass
				) }
				role="img"
				aria-label={ dotLabel }
				title={ dotLabel }
			>
				{ status === 'stopped' && ! isLive ? (
					<span className={ styles.pauseMark } aria-hidden="true" />
				) : (
					<span className={ clsx( styles.dot, dotClass ) } aria-hidden="true" />
				) }
				{ ! showSiteIcon && isLive ? (
					<span className={ styles.statusLabel }>{ __( 'Live' ) }</span>
				) : null }
			</span>
		) : null;

		return (
			<Tooltip.Provider delay={ 0 }>
				<Tooltip.Root>
					<Tooltip.Trigger
						ref={ ref }
						render={ <Button variant="minimal" tone="neutral" { ...props } /> }
						className={ clsx( styles.trigger, className ) }
					>
						{ showSiteIcon ? (
							<span className={ styles.siteIconWrap }>
								<SiteIcon
									className={ clsx(
										styles.siteIcon,
										status === 'stopped' && ! isLive && styles.siteIcon_stopped
									) }
									seed={ siteIconSeed ?? `${ siteName }:${ siteUrl }` }
									imageSrc={ siteIconImage }
								/>
								{ statusBadge }
							</span>
						) : null }
						<span className={ styles.identity }>
							<span className={ styles.site }>{ siteName }</span>
							<span
								className={ clsx( styles.secondary, styles[ `secondary_${ secondaryTone }` ] ) }
							>
								<span className={ styles.secondaryLabel }>{ secondaryLabel }</span>
							</span>
						</span>
						{ showSiteIcon ? null : statusBadge }
						<Icon className={ styles.chevron } icon={ chevronDownSmall } />
					</Tooltip.Trigger>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
						{ __( 'Publish, preview, and more' ) }
					</Tooltip.Popup>
				</Tooltip.Root>
			</Tooltip.Provider>
		);
	}
);
