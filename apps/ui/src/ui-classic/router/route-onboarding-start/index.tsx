import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useGridArrowNavigation } from '@/hooks/use-grid-arrow-navigation';
import { WizardPage } from '../../components/wizard-page';
import { onboardingLayoutRoute } from '../layout-onboarding';
// Reuses the site picker's card styles so the choosers can't drift apart
// visually. No illustrations here for now — text-only cards.
import cardStyles from '../route-onboarding-home/style.module.css';
import styles from './style.module.css';

const cardClass = cardStyles.card;

/**
 * Undecided? The AI brief screen takes a prompt (and images) and starts the
 * agent building. It needs a WordPress.com login, so signed-out users see
 * the card dimmed with a login action instead.
 */
function DecideWithAiCard() {
	const { data: authUser } = useAuthUser();
	const login = useLogin();

	if ( ! authUser ) {
		return (
			<div className={ `${ cardClass } ${ styles.lockedCard }` }>
				<div className={ `${ cardStyles.cardText } ${ styles.lockedText }` }>
					<h3 className={ cardStyles.cardTitle }>{ __( 'Let AI help you decide' ) }</h3>
					<p className={ cardStyles.cardBody }>{ __( 'Requires a WordPress.com login' ) }</p>
				</div>
				<Button
					type="button"
					variant="outline"
					tone="neutral"
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					{ __( 'Log in' ) }
				</Button>
			</div>
		);
	}

	return (
		<Link to="/onboarding/ai" className={ cardClass } data-arrow-nav-item>
			<div className={ cardStyles.cardText }>
				<h3 className={ cardStyles.cardTitle }>{ __( 'Let AI help you decide' ) }</h3>
				<p className={ cardStyles.cardBody }>
					{ __( 'Not sure yet? Describe your idea and build it with the Studio agent' ) }
				</p>
			</div>
		</Link>
	);
}

export function OnboardingStartPage() {
	const handleGridKeyDown = useGridArrowNavigation();
	const navigate = useNavigate();
	return (
		<WizardPage
			title={ __( 'What do you want to build?' ) }
			subtitle={ __( 'Start with a site or a plugin. You can always add more later.' ) }
			onBack={ () => void navigate( { to: '/onboarding/tour', search: { step: 'agent' } } ) }
		>
			<div className={ cardStyles.cards } onKeyDown={ handleGridKeyDown }>
				<Link to="/onboarding" className={ cardClass } data-arrow-nav-item>
					<div className={ cardStyles.cardText }>
						<h3 className={ cardStyles.cardTitle }>{ __( 'Build a site' ) }</h3>
						<p className={ cardStyles.cardBody }>
							{ __( 'Create a new WordPress site, import a backup, or connect a live one' ) }
						</p>
					</div>
				</Link>
				<Link to="/onboarding/plugin" className={ cardClass } data-arrow-nav-item>
					<div className={ cardStyles.cardText }>
						<h3 className={ cardStyles.cardTitle }>{ __( 'Build a plugin' ) }</h3>
						<p className={ cardStyles.cardBody }>
							{ __( 'Start a new plugin or work on one you already have' ) }
						</p>
					</div>
				</Link>
				<DecideWithAiCard />
			</div>
		</WizardPage>
	);
}

export const onboardingStartRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/start',
	component: OnboardingStartPage,
} );
