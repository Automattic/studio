import {
	ADD_AI_CREDITS_URL,
	getStudioCodeAiAccessState,
} from '@studio/common/lib/studio-assistant-quota';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { chartBar, external } from '@wordpress/icons';
import { Icon, Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import { AiCreditsDetailsDialog } from '@/components/ai-credits-details-dialog';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useUserLocale } from '@/data/queries/use-user-locale';
import styles from './style.module.css';

export function AiCreditsControl() {
	const connector = useConnector();
	const locale = useUserLocale();
	const navigate = useNavigate();
	const [ menuOpen, setMenuOpen ] = useState( false );
	const [ detailsOpen, setDetailsOpen ] = useState( false );
	const { data: quota } = useStudioAssistantQuota();

	// The server includes the per-pool balances only when AI credits are
	// enabled for the account (STU-2235); without them the composer keeps its
	// pre-credits layout.
	if (
		! quota ||
		getStudioCodeAiAccessState( quota ) !== 'available' ||
		( quota.allowanceRemaining === undefined && quota.purchasedRemaining === undefined )
	) {
		return null;
	}

	const remaining = ( quota.allowanceRemaining ?? 0 ) + ( quota.purchasedRemaining ?? 0 );
	const formattedRemaining = new Intl.NumberFormat( locale ).format( remaining );

	return (
		<>
			<Menu.Root modal={ false } open={ menuOpen } onOpenChange={ setMenuOpen }>
				<Tooltip.Root disabled={ menuOpen }>
					<Menu.Trigger
						render={
							<Tooltip.Trigger
								render={
									<button
										type="button"
										className={ styles.iconButton }
										aria-label={ __( 'AI credits' ) }
									/>
								}
							>
								<Icon icon={ chartBar } size={ 16 } />
							</Tooltip.Trigger>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
						{ sprintf(
							/* translators: %s: total number of AI credits remaining (e.g. 1,110,000). */
							__( 'AI credits · %s remaining' ),
							formattedRemaining
						) }
					</Tooltip.Popup>
				</Tooltip.Root>
				<Menu.Popup side="top" align="end">
					<div className={ styles.aiCreditsSummary }>
						<span>{ __( 'AI credits' ) }</span>
						<strong>
							{ sprintf(
								/* translators: %s: total number of AI credits remaining (e.g. 1,110,000). */
								__( '%s remaining' ),
								formattedRemaining
							) }
						</strong>
					</div>
					<Menu.Separator />
					<Menu.Item onClick={ () => void connector.openExternalUrl( ADD_AI_CREDITS_URL ) }>
						{ __( 'Add AI credits' ) }
						<Icon icon={ external } size={ 14 } aria-hidden="true" />
					</Menu.Item>
					<Menu.Item onClick={ () => setDetailsOpen( true ) }>
						{ __( 'How AI credits work' ) }
					</Menu.Item>
					<Menu.Item
						onClick={ () => void navigate( { to: '/settings', search: { tab: 'usage' } } ) }
					>
						{ __( 'Usage settings' ) }
					</Menu.Item>
				</Menu.Popup>
			</Menu.Root>
			<AiCreditsDetailsDialog open={ detailsOpen } onOpenChange={ setDetailsOpen } />
		</>
	);
}
