import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
import { CloudPage } from '../cloud-page';
import { checkoutUrl, parsePlanSlug, PeriodToggle, PlanCards, type BillingPeriod } from '../plans';
import styles from '../style.module.css';

export interface EndedPlan {
	// Until when the user's machine and sites are kept.
	keptUntil: string;
	// Renews the plan that ended, when WordPress.com still offers it.
	renewUrl: string | null;
}

/**
 * For a signed-in user without a plan, or whose plan ended: checkout opens on WordPress.com in
 * another tab, and the page sets up the workspace once the plan is active (`onCheck`, which also
 * runs when the tab gets focus back).
 */
export function CloudPlanPicker( {
	chosenPlan,
	ended,
	checking,
	onCheck,
	onSignOut,
}: {
	// The plan picked before signing in (`?plan=`), already selected.
	chosenPlan: string | null;
	ended: EndedPlan | null;
	checking: boolean;
	onCheck: () => void;
	onSignOut: () => void;
} ) {
	const chosen = parsePlanSlug( chosenPlan );
	const [ period, setPeriod ] = useState< BillingPeriod >( chosen?.period ?? 'monthly' );
	const [ checkoutOpen, setCheckoutOpen ] = useState( false );

	const openCheckout = ( url: string ) => {
		window.open( url, '_blank', 'noopener' );
		setCheckoutOpen( true );
	};

	return (
		<CloudPage
			action={
				<button type="button" className={ styles.secondary } onClick={ onSignOut }>
					{ __( 'Sign out' ) }
				</button>
			}
		>
			<div className={ styles.sectionHead }>
				<span className={ styles.pill }>
					{ ended ? __( 'Plan ended' ) : __( 'One more step' ) }
				</span>
				<h1 className={ styles.title }>
					{ ended ? __( 'Your plan has ended.' ) : __( 'Choose your plan.' ) }
				</h1>
				<p className={ styles.lede }>
					{ ended
						? sprintf(
								/* translators: %s: a date, e.g. December 19, 2026. */
								__(
									'Your sites are kept until %s. Renew to pick up where you left off, or choose a plan below.'
								),
								new Intl.DateTimeFormat( undefined, { dateStyle: 'long' } ).format(
									new Date( ended.keptUntil )
								)
						  )
						: __(
								'Your workspace runs on a Studio Cloud plan. Checkout opens on WordPress.com, and your workspace is ready about a minute after you pay.'
						  ) }
				</p>
				{ ended?.renewUrl ? (
					<div className={ styles.actions }>
						<button
							type="button"
							className={ styles.primary }
							onClick={ () => openCheckout( ended.renewUrl! ) }
						>
							{ __( 'Renew your plan' ) }
						</button>
					</div>
				) : null }
			</div>
			{ checkoutOpen ? (
				<div className={ styles.checkoutNote } role="status">
					<p>
						{ __(
							'Finish checkout in the WordPress.com tab, then come back here. Your workspace sets itself up as soon as your plan is active.'
						) }
					</p>
					<button
						type="button"
						className={ styles.secondary }
						disabled={ checking }
						onClick={ onCheck }
					>
						{ checking ? __( 'Checking…' ) : __( 'I’ve paid, continue' ) }
					</button>
				</div>
			) : null }
			<PeriodToggle period={ period } onChange={ setPeriod } />
			<PlanCards
				period={ period }
				featured={ chosen?.tier }
				actionLabel={ __( 'Continue to checkout' ) }
				onChoose={ ( slug ) => openCheckout( checkoutUrl( slug ) ) }
			/>
		</CloudPage>
	);
}
