import { __ } from '@wordpress/i18n';
import { chevronDownSmall } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './dropdown-trigger.module.css';
import type { ComponentProps, ElementRef } from 'react';

export type SiteStatus = 'running' | 'stopped' | 'transitioning';

type Props = Omit< ComponentProps< typeof Button >, 'children' > & {
	siteName: string;
	siteUrl: string;
	status: SiteStatus;
	statusLabel: string;
	environment: 'local' | 'live';
};

export const DropdownTrigger = forwardRef< ElementRef< typeof Button >, Props >(
	function DropdownTrigger(
		{ siteName, siteUrl, status, statusLabel, environment, className, ...props },
		ref
	) {
		// In live mode the local server's running/stopped status is irrelevant
		// to what the agent targets; use a dedicated dot color so the trigger
		// visibly mirrors the environment pill.
		const dotClass = environment === 'live' ? styles.dot_live : styles[ `dot_${ status }` ];
		return (
			<Button
				ref={ ref }
				variant="minimal"
				tone="neutral"
				size="small"
				className={ clsx( styles.trigger, className ) }
				{ ...props }
			>
				<span className={ styles.site }>{ siteName }</span>
				<span className={ styles.status }>
					<span className={ clsx( styles.dot, dotClass ) } role="img" aria-label={ statusLabel } />
					<span className={ styles.env }>
						{ environment === 'live' ? __( 'Live' ) : __( 'Local' ) }
					</span>
				</span>
				<span className={ styles.url }>{ siteUrl }</span>
				<Icon icon={ chevronDownSmall } />
			</Button>
		);
	}
);
