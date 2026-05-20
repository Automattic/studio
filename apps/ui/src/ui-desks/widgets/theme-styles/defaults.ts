import type { ThemeGlobalStyles } from '@/ui-desks/widgets/theme/api';

export const DEFAULT_THEME_STYLES_WIDGET_PROPS: ThemeGlobalStyles = {
	palette: [
		{ slug: 'background', name: 'Background', color: '#ffffff' },
		{ slug: 'foreground', name: 'Foreground', color: '#111111' },
	],
	fontFamily: 'system-ui, sans-serif',
	textColor: '#111111',
	backgroundColor: '#ffffff',
};

export function getThemeStylesWidgetProps(
	styles: ThemeGlobalStyles | null | undefined
): ThemeGlobalStyles {
	return styles ?? DEFAULT_THEME_STYLES_WIDGET_PROPS;
}
