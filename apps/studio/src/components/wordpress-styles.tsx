import wordpressStylesRtlUrl from '@wordpress/components/build-style/style-rtl.css?url';
import wordpressStylesUrl from '@wordpress/components/build-style/style.css?url';
import { useI18n } from '@wordpress/react-i18n';
import { DynamicStylesheet } from 'src/components/dynamic-stylesheet';

const WORDPRESS_STYLES_ID = 'wordpress-components-style';

export const getWordpressStylesHref = ( isRtl: boolean ) =>
	isRtl ? wordpressStylesRtlUrl : wordpressStylesUrl;

export const WordPressStyles = () => {
	const { isRTL } = useI18n();
	const isRtl = isRTL();

	const href = getWordpressStylesHref( isRtl );

	return <DynamicStylesheet id={ WORDPRESS_STYLES_ID } href={ href } />;
};
