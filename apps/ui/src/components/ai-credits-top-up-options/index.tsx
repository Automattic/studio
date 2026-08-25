import {
	formatBuyMoreCreditsLabel,
	formatTopUpOptionAccessibleLabel,
	formatTopUpOptionLabel,
} from '@studio/common/lib/studio-assistant-top-up-pricing';
import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useId } from 'react';
import { useConnector } from '@/data/core';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useAddAiCreditsUrlBuilder } from '@/hooks/use-add-ai-credits-url';
import styles from './style.module.css';

function TopUpButton( {
	label,
	accessibleLabel,
	url,
}: {
	label: string;
	accessibleLabel?: string;
	url: string;
} ) {
	const connector = useConnector();
	return (
		<Button
			size="small"
			variant="outline"
			tone="neutral"
			aria-label={ accessibleLabel }
			onClick={ () => void connector.openExternalUrl( url ) }
		>
			{ label }
			<Button.Icon icon={ external } size={ 12 } />
		</Button>
	);
}

/**
 * A button per AI credit top-up the store priced for this account (STU-2326).
 * The options and their prices come from the server, so the row renders
 * whatever comes back, in any number. When pricing can't be fetched the single
 * fixed top-up stands in — the user is never left without a way to buy — and
 * while it's still loading the row stays out rather than offering a button
 * it's about to replace.
 *
 * `withHeading` names the row for surfaces that don't already introduce it;
 * `centered` is for the out-of-credits marker, whose copy is centred.
 */
export function AiCreditsTopUpOptions( {
	className,
	withHeading = false,
	centered = false,
}: {
	className?: string;
	withHeading?: boolean;
	centered?: boolean;
} ) {
	const buildAddAiCreditsUrl = useAddAiCreditsUrlBuilder();
	const locale = useUserLocale();
	const headingId = useId();
	// `isLoading`, not `isPending`: a query that never runs (signed out, or a
	// host with no pricing source) stays pending forever, and these surfaces
	// must still offer a way to buy.
	const { data: pricing, isLoading } = useStudioAssistantTopUpPricing();
	const options = pricing?.options ?? [];

	if ( isLoading ) {
		return null;
	}

	return (
		<div className={ clsx( styles.topUp, centered && styles.topUpCentered, className ) }>
			{ withHeading ? (
				<span className={ styles.topUpHeading } id={ headingId }>
					{ formatBuyMoreCreditsLabel() }
				</span>
			) : null }
			<div
				className={ styles.topUpOptions }
				role="group"
				aria-label={ withHeading ? undefined : __( 'Add AI credits' ) }
				aria-labelledby={ withHeading ? headingId : undefined }
			>
				{ options.length > 0 ? (
					options.map( ( option ) => (
						<TopUpButton
							key={ option.credits }
							label={ formatTopUpOptionLabel( option, locale ) }
							accessibleLabel={ formatTopUpOptionAccessibleLabel( option, locale ) }
							url={ buildAddAiCreditsUrl( option.credits ) }
						/>
					) )
				) : (
					<TopUpButton label={ __( 'Add AI credits' ) } url={ buildAddAiCreditsUrl() } />
				) }
			</div>
		</div>
	);
}
