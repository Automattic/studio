import { __ } from '@wordpress/i18n';
import { chevronLeft } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { OnboardingFooter } from '@/components/onboarding-footer';
import sharedStyles from '../../router/layout-onboarding/style.module.css';
import styles from './style.module.css';
import type { ReactNode } from 'react';

interface WizardPrimaryAction {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	loading?: boolean;
}

interface WizardPageProps {
	title: string;
	subtitle?: string;
	/** Decorative visual rendered above the title. */
	illustration?: ReactNode;
	children: ReactNode;
	/**
	 * Renders the standard Back button pinned bottom-left. Omit on pages
	 * that have nowhere to go back to (the layout's close button covers
	 * users who arrived with existing sites).
	 */
	onBack?: () => void;
	backLabel?: string;
	/**
	 * Bottom-right primary action (Continue, Start building, …). Omit on
	 * picker pages whose cards navigate by themselves.
	 */
	primaryAction?: WizardPrimaryAction;
}

/**
 * One step of an onboarding-style wizard, rendered inside the onboarding
 * layout: shared title/subtitle typography, the step's content, and the
 * standard fixed footer. Step sequencing belongs to the route (keep the
 * current step in a search param so moving between steps is a navigation
 * and picks up the flow's view transitions — see route-onboarding-tour).
 */
export function WizardPage( {
	title,
	subtitle,
	illustration,
	children,
	onBack,
	backLabel,
	primaryAction,
}: WizardPageProps ) {
	const hasFooter = Boolean( onBack || primaryAction );
	return (
		<div
			className={
				hasFooter ? `${ sharedStyles.page } ${ styles.pageWithFooter }` : sharedStyles.page
			}
		>
			{ illustration }
			<h1 className={ sharedStyles.title }>{ title }</h1>
			{ subtitle ? <p className={ sharedStyles.subtitle }>{ subtitle }</p> : null }
			{ children }
			{ hasFooter && (
				<WizardFooter onBack={ onBack } backLabel={ backLabel } primaryAction={ primaryAction } />
			) }
		</div>
	);
}

function WizardFooter( {
	onBack,
	backLabel,
	primaryAction,
}: Pick< WizardPageProps, 'onBack' | 'backLabel' | 'primaryAction' > ) {
	return (
		<OnboardingFooter>
			{ /* The footer pins its first child bottom-left; keep the slot
			     occupied so a lone primary action stays bottom-right. */ }
			{ onBack ? (
				<Button type="button" variant="minimal" tone="neutral" onClick={ onBack }>
					<Icon icon={ chevronLeft } size={ 16 } />
					<span>{ backLabel ?? __( 'Back' ) }</span>
				</Button>
			) : (
				<span aria-hidden="true" />
			) }
			{ primaryAction && (
				<Button
					type="button"
					variant="solid"
					tone="brand"
					disabled={ primaryAction.disabled }
					loading={ primaryAction.loading }
					onClick={ primaryAction.onClick }
				>
					{ primaryAction.label }
				</Button>
			) }
		</OnboardingFooter>
	);
}
