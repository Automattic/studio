import { __ } from '@wordpress/i18n';
import { useOnboardingHints, useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { GlobeIcon, XIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import styles from './style.module.css';

export function ShareIntro( { onDismiss }: { onDismiss: () => void } ) {
	const { data: hints } = useOnboardingHints();
	const setHints = useSetOnboardingHints();
	if ( ! hints || hints.shareHintDismissed ) return null;

	return (
		<section className={ styles.shareIntro } aria-label={ __( 'About sharing' ) }>
			<IconButton
				className={ styles.shareIntroDismiss }
				variant="ghost"
				size="icon-sm"
				icon={ <XIcon /> }
				label={ __( 'Dismiss sharing tip' ) }
				onClick={ () => {
					setHints.mutate( { shareHintDismissed: true } );
					onDismiss();
				} }
			/>
			<GlobeIcon className={ styles.shareIntroIcon } aria-hidden="true" />
			<h2>{ __( 'Share your work' ) }</h2>
			<p>
				{ __(
					'Choose a destination to create a preview or publish a live site. Available options depend on the provider.'
				) }
			</p>
		</section>
	);
}
