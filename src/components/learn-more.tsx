import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink, type DocsLinkKey } from 'src/lib/get-localized-link';
import { useI18nLocale } from 'src/stores';

export function LearnMoreLink( {
	docsLinksKey,
	className,
	learnHow,
}: {
	docsLinksKey: DocsLinkKey;
	className?: string;
	learnHow?: boolean;
} ) {
	const { __ } = useI18n();
	const locale = useI18nLocale();

	return (
		<Button
			className={ className }
			onClick={ ( e: React.MouseEvent ) => {
				e.stopPropagation();

				getIpcApi().openURL( getLocalizedLink( locale, docsLinksKey ) );
			} }
			variant="link"
		>
			{ learnHow ? __( 'Learn how' ) : __( 'Learn more' ) }
		</Button>
	);
}
