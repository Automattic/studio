import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionUIProvider, useSessionPreviewUI } from './use-session-ui';

function PreviewStatus( { label }: { label: string } ) {
	const preview = useSessionPreviewUI();
	return (
		<span>
			{ `${ label }:${ preview.open ? 'open' : 'closed' }:${ preview.path }:${
				preview.activeTabId
			}:${ preview.tabs.map( ( tab ) => tab.path ).join( ',' ) }` }
		</span>
	);
}

function PreviewToggle() {
	const preview = useSessionPreviewUI();
	return <button onClick={ preview.toggle }>Toggle preview</button>;
}

function PreviewNavigate() {
	const preview = useSessionPreviewUI();
	return <button onClick={ () => preview.navigate( '/wp-admin/' ) }>Navigate preview</button>;
}

function PreviewTabs() {
	const preview = useSessionPreviewUI();
	const firstTab = preview.tabs[ 0 ];
	const secondTab = preview.tabs[ 1 ];
	return (
		<>
			<button onClick={ () => preview.openTab() }>Open tab</button>
			<button onClick={ () => firstTab && preview.selectTab( firstTab.id ) }>
				Select first tab
			</button>
			<button onClick={ () => secondTab && preview.selectTab( secondTab.id ) }>
				Select second tab
			</button>
			<button onClick={ () => firstTab && preview.closeTab( firstTab.id ) }>Close first tab</button>
			<button onClick={ () => secondTab && preview.closeTab( secondTab.id ) }>
				Close second tab
			</button>
			<button onClick={ () => preview.closeTab( preview.activeTabId ) }>Close active tab</button>
			<button onClick={ () => preview.updateActiveTabPath( '/about/' ) }>
				Update active tab path
			</button>
		</>
	);
}

describe( 'SessionUIProvider', () => {
	it( 'does not reset preview state when nested inside an existing provider', () => {
		render(
			<SessionUIProvider>
				<PreviewStatus label="outer" />
				<SessionUIProvider>
					<PreviewToggle />
					<PreviewStatus label="inner" />
				</SessionUIProvider>
			</SessionUIProvider>
		);

		expect( screen.getByText( 'outer:closed:/:preview-tab-1:/' ) ).toBeVisible();
		expect( screen.getByText( 'inner:closed:/:preview-tab-1:/' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Toggle preview' } ) );

		expect( screen.getByText( 'outer:open:/:preview-tab-1:/' ) ).toBeVisible();
		expect( screen.getByText( 'inner:open:/:preview-tab-1:/' ) ).toBeVisible();
	} );

	it( 'opens and updates the preview path when navigating', () => {
		render(
			<SessionUIProvider>
				<PreviewStatus label="preview" />
				<PreviewNavigate />
			</SessionUIProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Navigate preview' } ) );

		expect( screen.getByText( 'preview:open:/wp-admin/:preview-tab-1:/wp-admin/' ) ).toBeVisible();
	} );

	it( 'opens and switches browser tabs', () => {
		render(
			<SessionUIProvider>
				<PreviewStatus label="preview" />
				<PreviewNavigate />
				<PreviewTabs />
			</SessionUIProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Navigate preview' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Open tab' } ) );

		expect( screen.getByText( 'preview:open:/:preview-tab-2:/wp-admin/,/' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Update active tab path' } ) );

		expect(
			screen.getByText( 'preview:open:/about/:preview-tab-2:/wp-admin/,/about/' )
		).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Select first tab' } ) );

		expect(
			screen.getByText( 'preview:open:/wp-admin/:preview-tab-1:/wp-admin/,/about/' )
		).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Select second tab' } ) );

		expect(
			screen.getByText( 'preview:open:/about/:preview-tab-2:/wp-admin/,/about/' )
		).toBeVisible();
	} );

	it( 'closes browser tabs and keeps a usable active tab', () => {
		render(
			<SessionUIProvider>
				<PreviewStatus label="preview" />
				<PreviewNavigate />
				<PreviewTabs />
			</SessionUIProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Navigate preview' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Open tab' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Update active tab path' } ) );

		expect(
			screen.getByText( 'preview:open:/about/:preview-tab-2:/wp-admin/,/about/' )
		).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Close first tab' } ) );

		expect( screen.getByText( 'preview:open:/about/:preview-tab-2:/about/' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Open tab' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Select first tab' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close active tab' } ) );

		expect( screen.getByText( 'preview:open:/:preview-tab-3:/' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Close active tab' } ) );

		expect( screen.getByText( 'preview:open:/:preview-tab-4:/' ) ).toBeVisible();
	} );
} );
