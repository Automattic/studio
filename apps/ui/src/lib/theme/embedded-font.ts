import interFont from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline';
import vazirmatnFont from './fonts/Vazirmatn-Variable.woff2?inline';

export function getEmbeddedFontData( fontFamily: string ): string {
	const source = fontFamily.includes( 'Vazirmatn' ) ? vazirmatnFont : interFont;
	return source.slice( source.indexOf( ',' ) + 1 );
}
