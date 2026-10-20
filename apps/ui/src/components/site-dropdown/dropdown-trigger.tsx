import { __, sprintf } from '@wordpress/i18n';
import { chevronDownSmall, globe } from '@wordpress/icons';
import { Button, Icon, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './dropdown-trigger.module.css';
import type { ComponentProps, ElementRef } from 'react';

export type SiteStatus = 'running' | 'stopped' | 'transitioning';

type Props = Omit< ComponentProps< typeof Button >, 'children' > & {
	siteName: string;
	environment: 'local' | 'live';
	secondaryLabel: string;
};

// The site's control in the top band: a globe and a chevron, naming the site
// and what the chat targets in its label.
export const DropdownTrigger = forwardRef< ElementRef< typeof Button >, Props >(
	function DropdownTrigger( { siteName, environment, secondaryLabel, className, ...props }, ref ) {
		/* translators: 1: site name, 2: what the chat targets, e.g. "Local preview". */
		const label = sprintf( __( '%1$s, %2$s' ), siteName, secondaryLabel );
		return (
			<Tooltip.Root>
				<Tooltip.Trigger
					ref={ ref }
					render={ <Button variant="minimal" tone="neutral" aria-label={ label } { ...props } /> }
					className={ clsx( styles.trigger, 'studio-control', className ) }
				>
					<span className={ styles.icon }>
						<Icon icon={ globe } size={ 20 } />
						{ environment === 'live' ? (
							<span className={ styles.liveDot } title={ __( 'Live site' ) } />
						) : null }
					</span>
					<Icon className={ styles.chevron } icon={ chevronDownSmall } size={ 16 } />
				</Tooltip.Trigger>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>{ label }</Tooltip.Popup>
			</Tooltip.Root>
		);
	}
);
