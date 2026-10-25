import { getLocalizedLink } from '@studio/common/lib/docs-links';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useConnector } from '@/data/core';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { Button } from '@/lib/ui';
import styles from './style.module.css';
import type { DocsLinkKey } from '@studio/common/lib/docs-links';
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
		<Button
			variant="inline-link"
			size="inline"
			className={ clsx( styles.link, className ) }
			onClick={ handleClick }
		>
			{ label }
		</Button>
	);
}

export function LearnMoreLink( props: Props ) {
	return <MoreLink { ...props } label={ __( 'Learn more…' ) } />;
}

export function LearnHowLink( props: Props ) {
	return <MoreLink { ...props } label={ __( 'Learn how…' ) } />;
}
