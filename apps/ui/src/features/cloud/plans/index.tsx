import { __, sprintf } from '@wordpress/i18n';
import { CheckIcon } from 'lucide-react';
import styles from '../style.module.css';

// Studio Cloud's plans, sold as WordPress.com products: `studio-<tier>-<period>`.

export type BillingPeriod = 'monthly' | 'yearly';
type PlanTier = 'cloud' | 'pro';

const planSlug = ( tier: PlanTier, period: BillingPeriod ) => `studio-${ tier }-${ period }`;

export const checkoutUrl = ( slug: string ) => `https://wordpress.com/checkout/studio/${ slug }`;

/** The tier and period a plan slug names, or null for anything else. */
export function parsePlanSlug(
	slug: string | null
): { tier: PlanTier; period: BillingPeriod } | null {
	const match = /^studio-(cloud|pro)-(monthly|yearly)$/.exec( slug ?? '' );
	return match ? { tier: match[ 1 ] as PlanTier, period: match[ 2 ] as BillingPeriod } : null;
}

const getPlans = () => [
	{
		tier: 'cloud' as const,
		name: 'Studio Cloud',
		monthly: 20,
		yearly: 192,
		text: __( 'Everything you need to build WordPress sites with Studio Code.' ),
		features: [
			__( '$10 of AI credits every month' ),
			__( 'Up to 10 sites, 2 running at once' ),
			__( '6 GB of storage' ),
			__( 'Private sites and preview links' ),
		],
	},
	{
		tier: 'pro' as const,
		name: 'Studio Pro',
		monthly: 50,
		yearly: 480,
		text: __( 'More room and more AI, for building every day.' ),
		features: [
			__( '$30 of AI credits every month' ),
			__( 'Unlimited sites, 5 running at once' ),
			__( '30 GB of storage' ),
			__( 'Twice the CPU for faster builds' ),
		],
	},
];

export function PeriodToggle( {
	period,
	onChange,
}: {
	period: BillingPeriod;
	onChange: ( period: BillingPeriod ) => void;
} ) {
	const options: [ BillingPeriod, string ][] = [
		[ 'monthly', __( 'Monthly' ) ],
		[ 'yearly', __( 'Yearly, save 20%' ) ],
	];
	return (
		<div className={ styles.period } role="group" aria-label={ __( 'Billing period' ) }>
			{ options.map( ( [ value, label ] ) => (
				<button
					key={ value }
					type="button"
					aria-pressed={ period === value }
					onClick={ () => onChange( value ) }
				>
					{ label }
				</button>
			) ) }
		</div>
	);
}

export function PlanCards( {
	period,
	featured = 'cloud',
	actionLabel,
	onChoose,
}: {
	period: BillingPeriod;
	featured?: PlanTier;
	actionLabel: string;
	onChoose: ( slug: string ) => void;
} ) {
	return (
		<div className={ styles.plans }>
			{ getPlans().map( ( plan ) => (
				<article
					key={ plan.tier }
					className={ styles.card }
					data-featured={ plan.tier === featured || undefined }
				>
					<span className={ styles.name }>{ plan.name }</span>
					<p className={ styles.price }>
						${ period === 'yearly' ? plan.yearly / 12 : plan.monthly }
						<span>{ __( '/month' ) }</span>
					</p>
					<p className={ styles.yearly }>
						{ period === 'yearly'
							? sprintf(
									/* translators: %s: the yearly price, e.g. $192. */
									__( '%s billed yearly' ),
									`$${ plan.yearly }`
							  )
							: __( 'Billed monthly' ) }
					</p>
					<p>{ plan.text }</p>
					<ul className={ styles.list }>
						{ plan.features.map( ( feature ) => (
							<li key={ feature }>
								<CheckIcon aria-hidden="true" />
								{ feature }
							</li>
						) ) }
					</ul>
					<button
						type="button"
						className={ plan.tier === featured ? styles.primary : styles.secondary }
						onClick={ () => onChoose( planSlug( plan.tier, period ) ) }
					>
						{ actionLabel }
					</button>
				</article>
			) ) }
		</div>
	);
}
