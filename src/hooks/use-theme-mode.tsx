import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeModeContextType {
	themeMode: ThemeMode;
	isDarkMode: boolean;
	setThemeMode: (mode: ThemeMode) => void;
}

const ThemeModeContext = createContext<ThemeModeContextType | undefined>(undefined);

export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
	const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
	const [isDarkMode, setIsDarkMode] = useState(false);

	const setThemeMode = async (mode: ThemeMode) => {
		setThemeModeState(mode);
		await getIpcApi().saveUserPreference('themeMode', mode);
		updateIsDarkMode(mode);
	};

	const updateIsDarkMode = (mode: ThemeMode) => {
		if (mode === 'dark') {
			setIsDarkMode(true);
		} else if (mode === 'light') {
			setIsDarkMode(false);
		} else {
			// System preference
			const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			setIsDarkMode(prefersDark);
		}
	};

	useEffect(() => {
		// Load saved preference
		const loadThemeMode = async () => {
			const savedMode = (await getIpcApi().getUserPreference(
				'themeMode'
			)) as ThemeMode | undefined;
			if (savedMode) {
				setThemeModeState(savedMode);
				updateIsDarkMode(savedMode);
			} else {
				updateIsDarkMode('system');
			}
		};

		loadThemeMode();

		// Listen for system preference changes
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		const handleChange = () => {
			if (themeMode === 'system') {
				setIsDarkMode(mediaQuery.matches);
			}
		};

		mediaQuery.addEventListener('change', handleChange);
		return () => mediaQuery.removeEventListener('change', handleChange);
	}, [themeMode]);

	return (
		<ThemeModeContext.Provider value={{ themeMode, isDarkMode, setThemeMode }}>
			{children}
		</ThemeModeContext.Provider>
	);
};

export const useThemeMode = () => {
	const context = useContext(ThemeModeContext);
	if (context === undefined) {
		throw new Error('useThemeMode must be used within a ThemeModeProvider');
	}
	return context;
};