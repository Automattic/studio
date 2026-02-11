import { useI18n } from '@wordpress/react-i18n';
import { DynamicStylesheet } from 'src/components/dynamic-stylesheet';

const WORDPRESS_STYLES_ID = 'wordpress-components-style';

// @ts-expect-error - import.meta syntax is not supported by TypeScript's commonjs module setting,
// but Vite handles this at build time and replaces it with the actual value
const isDevelopment = import.meta.env.DEV;

const repoRoot = import.meta.env.VITE_REPO_ROOT as string | undefined;
const repoRootNormalized = repoRoot ? repoRoot.replace( /\/$/, '' ) : '';
const WORDPRESS_STYLES_LTR = isDevelopment
	? `/@fs${ repoRootNormalized }/node_modules/@wordpress/components/build-style/style.css`
	: './main_window/styles/wordpress-components-style.css';

const WORDPRESS_STYLES_RTL = isDevelopment
	? `/@fs${ repoRootNormalized }/node_modules/@wordpress/components/build-style/style-rtl.css`
	: './main_window/styles/wordpress-components-style-rtl.css';

export const WordPressStyles = () => {
	const { isRTL } = useI18n();
	const isRtl = isRTL();

	const href = isRtl ? WORDPRESS_STYLES_RTL : WORDPRESS_STYLES_LTR;

	return <DynamicStylesheet id={ WORDPRESS_STYLES_ID } href={ href } />;
};
