import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink, type DocsLinkKey } from 'src/lib/get-localized-link';
import { useI18nLocale } from 'src/stores';

interface LinkProps {
	docsLinksKey: DocsLinkKey;
	className?: string;
}

function MoreLink( { docsLinksKey, className, label }: LinkProps & { label: string } ) {
	const { __ } = useI18n();
	const locale = useI18nLocale();

	return (
		<Button
			className={ cx( 'learn-more-link', className ) }
			onClick={ ( e: React.MouseEvent ) => {
				e.stopPropagation();

				getIpcApi().openURL( getLocalizedLink( locale, docsLinksKey ) );
			} }
			variant="link"
		>
			{ label }
		</Button>
	);
}

export function LearnMoreLink( props: LinkProps ) {
	const { __ } = useI18n();

	return <MoreLink { ...props } label={ __( 'Learn more' ) } />;
}

export function LearnHowLink( props: LinkProps ) {
	const { __ } = useI18n();

	return <MoreLink { ...props } label={ __( 'Learn how' ) } />;
}
