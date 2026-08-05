import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import { WordPressMenu } from './index';
import type { SiteDetails } from '@/data/core';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

vi.mock( '@wordpress/ui', async () => {
	const { cloneElement } = await import( 'react' );
	return {
		Button: ( {
			children,
			tone,
			variant,
			size,
			...props
		}: ButtonHTMLAttributes< HTMLButtonElement > & {
			children?: ReactNode;
			tone?: string;
			variant?: string;
			size?: string;
		} ) => {
			void tone;
			void variant;
			void size;
			return <button { ...props }>{ children }</button>;
		},
		Tooltip: {
			Root: ( { children }: { children: ReactNode } ) => <>{ children }</>,
			Trigger: ( {
				render: renderProp,
				children,
			}: {
				render: React.ReactElement< { children?: ReactNode } >;
				children?: ReactNode;
			} ) => cloneElement( renderProp, {}, children ),
			Positioner: () => null,
			Popup: () => null,
		},
	};
} );

vi.mock( '@/components/menu', () => ( {
	Root: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	Trigger: ( { render: renderProp }: { render: ReactNode } ) => <>{ renderProp }</>,
	Popup: ( { children }: { children: ReactNode } ) => <div role="menu">{ children }</div>,
	Separator: () => <hr />,
	Group: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	GroupLabel: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	RadioGroup: ( {
		children,
		onValueChange,
	}: {
		children: ReactNode;
		onValueChange: ( value: string ) => void;
	} ) => {
		void onValueChange;
		return <div>{ children }</div>;
	},
	RadioItem: ( { children, value }: { children: ReactNode; value: string } ) => (
		<button type="button" role="menuitemradio" data-value={ value }>
			{ children }
		</button>
	),
	Item: ( { children, onClick }: { children: ReactNode; onClick?: () => void } ) => (
		<button type="button" onClick={ onClick }>
			{ children }
		</button>
	),
} ) );

vi.mock( '@/hooks/use-open-site-url', () => ( {
	useOpenSiteUrl: vi.fn(),
} ) );

const SITE = {
	id: 'site-1',
	name: 'Demo Site',
	path: '/Users/example/Studio/demo-site',
	running: true,
	themeDetails: { isBlockTheme: true },
} as SiteDetails;

describe( 'WordPressMenu', () => {
	const openSiteUrl = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		window.localStorage.clear();
		vi.mocked( useOpenSiteUrl ).mockReturnValue( openSiteUrl );
	} );

	it( 'opens WP Admin from the default split action', () => {
		render( <WordPressMenu site={ SITE } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Open WP Admin' } ) );

		expect( openSiteUrl ).toHaveBeenCalledWith( '/wp-admin/' );
	} );

	it( 'offers direct WordPress screens for the active theme', () => {
		render( <WordPressMenu site={ SITE } /> );

		expect( screen.getByRole( 'button', { name: /Site Editor/ } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: /Styles/ } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: /Patterns/ } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: /Pages/ } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: /Media Library/ } ) ).toBeVisible();
	} );

	it( 'repeats the last selected WordPress screen from the split action', () => {
		render( <WordPressMenu site={ SITE } /> );

		fireEvent.click( screen.getByRole( 'button', { name: /Pages/ } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Open Pages' } ) );

		expect( openSiteUrl ).toHaveBeenLastCalledWith( '/wp-admin/edit.php?post_type=page' );
		expect( openSiteUrl ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'offers Studio and the default browser as opening targets', () => {
		render( <WordPressMenu site={ SITE } /> );

		expect( screen.getByText( 'Open WordPress screens in' ) ).toBeVisible();
		expect( screen.getByRole( 'menuitemradio', { name: 'Studio' } ) ).toBeVisible();
		expect( screen.getByRole( 'menuitemradio', { name: 'Default browser' } ) ).toBeVisible();
	} );

	it( 'restores the default-browser target', () => {
		window.localStorage.setItem( 'studio:wordpress-menu:target', 'browser' );

		render( <WordPressMenu site={ SITE } /> );

		expect( useOpenSiteUrl ).toHaveBeenCalledWith( SITE, 'browser' );
	} );
} );
