import { getAddAiCreditsUrl } from '@studio/common/lib/studio-assistant-quota';
import {
	formatBuyMoreCreditsLabel,
	formatTopUpOptionAccessibleLabel,
	formatTopUpOptionLabel,
} from '@studio/common/lib/studio-assistant-top-up-pricing';
import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { useId } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useI18nLocale } from 'src/stores';
import { useGetStudioAssistantTopUpPricing } from 'src/stores/wpcom-api';

function TopUpButton( {
	label,
	accessibleLabel,
	credits,
}: {
	label: string;
	accessibleLabel?: string;
	credits?: number;
} ) {
	return (
		<Button
			variant="secondary"
			size="small"
			icon={ external }
			iconPosition="right"
			iconSize={ 12 }
			aria-label={ accessibleLabel }
			onClick={ () =>
				void getIpcApi().openURL( getAddAiCreditsUrl( { returnsToDesktop: true, credits } ) )
			}
		>
			{ label }
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
	const locale = useI18nLocale();
	const headingId = useId();
	const { data: pricing, isLoading } = useGetStudioAssistantTopUpPricing();
	const options = pricing?.options ?? [];

	if ( isLoading ) {
		return null;
	}

	return (
		<div className={ cx( 'flex flex-col gap-1', centered && 'items-center', className ) }>
			{ withHeading ? (
				<span className="text-frame-text-secondary text-xs" id={ headingId }>
					{ formatBuyMoreCreditsLabel() }
				</span>
			) : null }
			<div
				className={ cx( 'flex flex-wrap gap-1 text-xs', centered && 'justify-center' ) }
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
							credits={ option.credits }
						/>
					) )
				) : (
					<TopUpButton label={ __( 'Add AI credits' ) } />
				) }
			</div>
		</div>
	);
}
