import {
	AlertDialog,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@studio/ds';
import { useSearch } from '@tanstack/react-router';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useRef } from 'react';
import { useSetUsageNoticeSeen, useUsageNoticePending } from '@/data/queries/use-usage-notice';
import { useOpenSettings } from '@/data/use-open-settings';
import { LearnMoreLink } from '../learn-more';
import { useOnboardingGuide } from '../onboarding-guide/use-onboarding-guide';
import styles from './style.module.css';

/**
 * Tells people onboarded before usage statistics were linked to the WordPress.com account that
 * they now are. Shown once, after any other root dialog or guide closes. Until it is dismissed,
 * logged-in events stay anonymous; new users see the same at onboarding and never get it.
 */
export function UsageNotice() {
	const { welcome, settings, addSite } = useSearch( { strict: false } ) as {
		welcome?: true;
		settings?: string;
		addSite?: string;
	};
	const { isOpen: guideOpen } = useOnboardingGuide();
	const { data: pending } = useUsageNoticePending();
	const markSeen = useSetUsageNoticeSeen();
	const openSettings = useOpenSettings();
	const gotIt = useRef< HTMLButtonElement >( null );

	if ( ! pending || welcome || settings || addSite || guideOpen ) {
		return null;
	}

	const dismiss = () => markSeen.mutate();
	const openUsageSettings = () => {
		dismiss();
		openSettings( 'general', undefined, 'usage-statistics' );
	};

	return (
		<AlertDialog
			open
			onOpenChange={ ( open ) => {
				if ( ! open ) dismiss();
			} }
		>
			<DialogContent layout="confirmation" showCloseButton={ false } initialFocus={ gotIt }>
				<DialogHeader>
					<DialogTitle>{ __( 'Usage statistics are changing' ) }</DialogTitle>
					<DialogDescription>
						{ createInterpolateElement(
							__(
								"When you're logged in to WordPress.com, stats are now linked to your account. This helps us improve WordPress Studio. You can turn this off at any time in <settings_link>Settings</settings_link>."
							),
							{
								settings_link: (
									<Button
										variant="inline-link"
										size="inline"
										className={ styles.link }
										onClick={ openUsageSettings }
									/>
								),
							}
						) }{ ' ' }
						<LearnMoreLink docsLinksKey="docsTelemetry" />
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={ openUsageSettings }>
						{ __( 'Open Settings' ) }
					</Button>
					<Button ref={ gotIt } variant="accent" onClick={ dismiss }>
						{ __( 'Got it' ) }
					</Button>
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
