import { getLocalizedLink } from '@studio/common/lib/docs-links';
import { Menu } from '@studio/ds';
import {
	BookOpenIcon,
	MessageSquareTextIcon,
	CircleHelpIcon,
	KeyboardIcon,
} from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useOpenFeedback } from '@/data/use-open-feedback';
import { useOpenSettings } from '@/data/use-open-settings';

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
					<CircleHelpIcon />
					{ __( 'Help Center' ) }
				</Menu.Item>
				<Menu.Item onClick={ () => openSettings( 'keyboard' ) }>
					<KeyboardIcon />
					{ __( 'Keyboard shortcuts' ) }
				</Menu.Item>
				<Menu.Item onClick={ openFeedback }>
					<MessageSquareTextIcon />
					{ __( 'Send feedback' ) }
				</Menu.Item>
			</Menu.SubmenuPopup>
		</Menu.SubmenuRoot>
	);
}
