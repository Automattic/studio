import cliIllustration from '@studio/common/assets/whats-new/cli.svg';
import darkModeIllustration from '@studio/common/assets/whats-new/dark-mode.svg';
import nativePhpIllustration from '@studio/common/assets/whats-new/native-php.svg';
import phpMyAdminIllustration from '@studio/common/assets/whats-new/phpmyadmin.svg';
import studioCodeIllustration from '@studio/common/assets/whats-new/studio-code.svg';
import { __, sprintf } from '@wordpress/i18n';
import styles from './style.module.css';
import type { GuideIllustrationId } from '@/data/onboarding/guide';

// Shared with the classic renderer's What's New modal. The orientation ids have
// no art yet and fall through to the tinted placeholder slot below.
const ILLUSTRATIONS: Partial< Record< GuideIllustrationId, string > > = {
	'studio-code': studioCodeIllustration,
	'native-php': nativePhpIllustration,
	'dark-mode': darkModeIllustration,
	phpmyadmin: phpMyAdminIllustration,
	cli: cliIllustration,
};

export function hasIllustration( id: GuideIllustrationId ): boolean {
	return Boolean( ILLUSTRATIONS[ id ] );
}

export function GuideIllustration( { id, title }: { id: GuideIllustrationId; title: string } ) {
	const source = ILLUSTRATIONS[ id ];
	if ( ! source ) {
		return <div className={ styles.illustration } data-illustration={ id } />;
	}
	return (
		<img
			className={ styles.illustration }
			src={ source }
			alt={ sprintf(
				/* translators: %s is the title of the guide page the illustration belongs to. */
				__( 'Illustration for %s' ),
				title
			) }
		/>
	);
}
