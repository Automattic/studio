import { getLocalizedLink } from '@studio/common/lib/docs-links';
import { __ } from '@wordpress/i18n';
import { BookOpenIcon } from 'lucide-react';
import { useConnector } from '@/data/core';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useOpenFeedback } from '@/data/use-open-feedback';
import { useOpenSettings } from '@/data/use-open-settings';
import { FeedbackIcon, HelpCenterIcon, KeyboardIcon } from '@/lib/icons';
import { Menu } from '@/lib/ui';

export function SupportMenu() {
	const connector = useConnector();
	const locale = useUserLocale();
	const openSettings = useOpenSettings();
	const openFeedback = useOpenFeedback();

	return (
		<Menu.SubmenuRoot>
			<Menu.SubmenuTrigger>
				<BookOpenIcon />
				{ __( 'Support' ) }
			</Menu.SubmenuTrigger>
			<Menu.SubmenuPopup>
				<Menu.Item
					onClick={ () =>
						void connector.openExternalUrl( getLocalizedLink( locale, 'docsStudio' ) )
					}
				>
					<HelpCenterIcon />
					{ __( 'Help Center' ) }
				</Menu.Item>
				<Menu.Item onClick={ () => openSettings( 'keyboard' ) }>
					<KeyboardIcon />
					{ __( 'Keyboard shortcuts' ) }
				</Menu.Item>
				{ openFeedback && (
					<Menu.Item onClick={ openFeedback }>
						<FeedbackIcon />
						{ __( 'Send feedback' ) }
					</Menu.Item>
				) }
			</Menu.SubmenuPopup>
		</Menu.SubmenuRoot>
	);
}
