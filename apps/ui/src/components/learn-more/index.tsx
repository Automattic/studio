import { __ } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { getLocalizedLink } from '@/lib/docs-links';
import styles from './style.module.css';
import type { DocsLinkKey } from '@/lib/docs-links';
import type { MouseEvent } from 'react';

interface Props {
	docsLinksKey: DocsLinkKey;
	className?: string;
}

function MoreLink( { docsLinksKey, className, label }: Props & { label: string } ) {
	const connector = useConnector();
	const locale = useUserLocale();

	const handleClick = ( event: MouseEvent ) => {
		event.stopPropagation();
		event.preventDefault();
		void connector.openExternalUrl( getLocalizedLink( locale, docsLinksKey ) );
	};

	return (
		<button
			type="button"
			className={ className ? `${ styles.link } ${ className }` : styles.link }
			onClick={ handleClick }
		>
			{ label }
		</button>
	);
}

export function LearnMoreLink( props: Props ) {
	return <MoreLink { ...props } label={ __( 'Learn more' ) } />;
}

export function LearnHowLink( props: Props ) {
	return <MoreLink { ...props } label={ __( 'Learn how' ) } />;
}
