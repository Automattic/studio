import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import {
	SessionUIProvider,
	useSessionPreviewUI,
	useSessionUIDispatch,
} from '@/data/use-session-ui';
import { createFakeConnector } from '@/test/fake-connector';
import type { ReactNode } from 'react';

beforeEach( () => localStorage.clear() );

function wrapper( { children }: { children: ReactNode } ) {
	return (
		<ConnectorProvider connector={ createFakeConnector() }>
			<SessionUIProvider>{ children }</SessionUIProvider>
		</ConnectorProvider>
	);
}

describe( 'useSessionPreviewUI site switching', () => {
	it( 'opens a never-previewed site at home instead of the previous site path', () => {
		const { result } = renderHook( () => useSessionPreviewUI(), { wrapper } );

		act( () => result.current.setSite( 'site-a' ) );
		act( () => result.current.updatePath( '/about' ) );
		expect( result.current.path ).toBe( '/about' );

		act( () => result.current.setSite( 'site-b' ) );
		expect( result.current.path ).toBe( '/' );
		expect( result.current.siteId ).toBe( 'site-b' );
	} );

	it( 'restores each site last visited path when switching back', () => {
		const { result } = renderHook( () => useSessionPreviewUI(), { wrapper } );

		act( () => result.current.setSite( 'site-a' ) );
		act( () => result.current.updatePath( '/about' ) );
		act( () => result.current.setSite( 'site-b' ) );
		act( () => result.current.updatePath( '/blog' ) );

		act( () => result.current.setSite( 'site-a' ) );
		expect( result.current.path ).toBe( '/about' );

		act( () => result.current.setSite( 'site-b' ) );
		expect( result.current.path ).toBe( '/blog' );
	} );

	it( 'keeps the path when the previewed site is unchanged', () => {
		const { result } = renderHook( () => useSessionPreviewUI(), { wrapper } );

		act( () => result.current.setSite( 'site-a' ) );
		act( () => result.current.updatePath( '/contact' ) );

		act( () => result.current.setSite( 'site-a' ) );
		expect( result.current.path ).toBe( '/contact' );
	} );
} );

describe( 'useSessionPreviewUI agent reloads', () => {
	function renderPreview() {
		return renderHook(
			() => ( { preview: useSessionPreviewUI(), dispatch: useSessionUIDispatch() } ),
			{ wrapper }
		);
	}

	it( 'reloads the current page in place, without opening a closed panel', () => {
		const { result } = renderPreview();
		act( () => result.current.preview.setSite( 'site-a' ) );
		act( () => result.current.preview.updatePath( DESIGN_SYSTEM_PREVIEW_PATH ) );
		act( () => result.current.preview.setOpen( false ) );
		const before = result.current.preview.reloadNonce;

		act( () => result.current.dispatch( { type: 'preview/reload' } ) );
		expect( result.current.preview.reloadNonce ).toBe( before + 1 );
		expect( result.current.preview.path ).toBe( DESIGN_SYSTEM_PREVIEW_PATH );
		expect( result.current.preview.open ).toBe( false );
	} );

	it( 'navigates a closed panel to the design system and opens it', () => {
		const { result } = renderPreview();
		act( () => result.current.preview.setSite( 'site-a' ) );
		act( () => result.current.preview.setOpen( false ) );

		act( () => result.current.preview.navigate( DESIGN_SYSTEM_PREVIEW_PATH ) );
		expect( result.current.preview.path ).toBe( DESIGN_SYSTEM_PREVIEW_PATH );
		expect( result.current.preview.open ).toBe( true );
	} );
} );

it( 'persists independent preview visibility and chat layout for each site', () => {
	const view = renderHook( () => useSessionPreviewUI(), { wrapper } );
	act( () => view.result.current.setSite( 'a', { running: true } ) );
	act( () => view.result.current.setOpen( false ) );
	act( () => view.result.current.setSite( 'b', { running: true } ) );
	expect( view.result.current.open ).toBe( true );
	act( () => view.result.current.setChatHidden( true ) );
	act( () => view.result.current.setSite( 'a', { running: true } ) );
	expect( view.result.current.open ).toBe( false );
	expect( view.result.current.chatHidden ).toBe( false );
	act( () => view.result.current.setSite( 'b', { running: true } ) );
	expect( view.result.current.chatHidden ).toBe( true );
	act( () => view.result.current.setOpen( false, { siteId: 'a' } ) );
	expect( view.result.current.open ).toBe( true );
	view.unmount();
	const reloaded = renderHook( () => useSessionPreviewUI(), { wrapper } );
	act( () => reloaded.result.current.setSite( 'a', { running: true } ) );
	expect( reloaded.result.current.open ).toBe( false );
	act( () => reloaded.result.current.setSite( 'b', { running: true } ) );
	expect( reloaded.result.current.chatHidden ).toBe( true );
	act( () => reloaded.result.current.setSite( 'split', { running: true } ) );
	expect( reloaded.result.current.chatHidden ).toBe( false );
} );

it( 'does not apply another site fullscreen layout when reloading a split preview', () => {
	const view = renderHook( () => useSessionPreviewUI(), { wrapper } );
	act( () => view.result.current.setSite( 'split', { running: true } ) );
	act( () => view.result.current.setOpen( true ) );
	act( () => view.result.current.setSite( 'full', { running: true } ) );
	act( () => view.result.current.setChatHidden( true ) );
	view.unmount();
	const reloaded = renderHook( () => useSessionPreviewUI(), { wrapper } );
	act( () => reloaded.result.current.setSite( 'split', { running: true } ) );
	expect( reloaded.result.current.open ).toBe( true );
	expect( reloaded.result.current.chatHidden ).toBe( false );
} );

it( 'persists each site’s current layout, including an explicit split choice', () => {
	const view = renderHook( () => useSessionPreviewUI(), { wrapper } );
	act( () => view.result.current.setSite( 'full', { running: true } ) );
	act( () => view.result.current.setChatHidden( true ) );
	act( () => view.result.current.setChatHidden( true, 'split' ) );
	act( () => view.result.current.setChatHidden( false, 'split' ) );
	view.unmount();
	const reloaded = renderHook( () => useSessionPreviewUI(), { wrapper } );
	expect( reloaded.result.current.chatHiddenBySiteId ).toEqual( { full: true } );
	act( () => reloaded.result.current.setSite( 'full', { running: true } ) );
	expect( reloaded.result.current.chatHidden ).toBe( true );
	act( () => reloaded.result.current.setSite( 'split', { running: true } ) );
	expect( reloaded.result.current.chatHidden ).toBe( false );
} );
