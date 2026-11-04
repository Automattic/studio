import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
	dismissToast,
	getNoticeHistory,
	getVisibleToasts,
	resetAppMessagesForTests,
} from '@/data/app-messages';
import { ConnectorProvider } from '@/data/core';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import { SITES_QUERY_KEY, useExportDatabase, useExportFullSite } from './use-sites';
import type { ReactNode } from 'react';

afterEach( resetAppMessagesForTests );

const exports = [
	[
		useExportFullSite,
		'exportFullSite',
		'Exporting site…',
		'Site exported',
		'Failed to export site',
	],
	[
		useExportDatabase,
		'exportDatabase',
		'Exporting database…',
		'Database exported',
		'Failed to export database',
	],
] as const;

it.each( exports )(
	'keeps %s progress through dismissal and unmount, then records one result',
	async ( useExport, method, progress, success ) => {
		const connector = createFakeConnector();
		const queryClient = createTestQueryClient();
		queryClient.setQueryData( SITES_QUERY_KEY, [ makeSite( { name: 'Ocean' } ) ] );
		let start!: () => void;
		let finish!: ( path: string ) => void;
		connector[ method ].mockImplementation( ( _siteId, options ) => {
			start = () => options?.onStarted?.();
			return new Promise( ( resolve ) => {
				finish = resolve;
			} );
		} );
		const view = renderHook( useExport, {
			wrapper: ( { children }: { children: ReactNode } ) => (
				<ConnectorProvider connector={ connector }>
					<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
				</ConnectorProvider>
			),
		} );
		act( () => view.result.current.mutate( 'site-1' ) );
		await waitFor( () => expect( start ).toBeDefined() );
		expect( getNoticeHistory() ).toHaveLength( 0 );
		act( start );
		expect( getNoticeHistory()[ 0 ] ).toMatchObject( {
			title: progress,
			description: 'Ocean',
			processing: true,
			dismissible: true,
		} );
		const id = getNoticeHistory()[ 0 ].id;
		act( () => dismissToast( id ) );
		view.unmount();
		await act( async () => finish( '/tmp/ocean.zip' ) );
		expect( getNoticeHistory() ).toHaveLength( 1 );
		expect( getVisibleToasts()[ 0 ] ).toMatchObject( { id, title: success, intent: 'success' } );
		expect( getVisibleToasts()[ 0 ].leaving ).not.toBe( true );
	}
);

it.each( exports )(
	'keeps a cancelled %s destination picker quiet',
	async ( useExport, method ) => {
		const connector = createFakeConnector();
		connector[ method ].mockResolvedValue( null );
		const queryClient = createTestQueryClient();
		const view = renderHook( useExport, {
			wrapper: ( { children }: { children: ReactNode } ) => (
				<ConnectorProvider connector={ connector }>
					<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
				</ConnectorProvider>
			),
		} );
		await act( () => view.result.current.mutateAsync( 'site-1' ) );
		expect( getNoticeHistory() ).toHaveLength( 0 );
	}
);

it.each( exports )(
	'replaces %s progress with a failure',
	async ( useExport, method, _progress, _success, failure ) => {
		const connector = createFakeConnector();
		connector[ method ].mockImplementation( async ( _siteId, options ) => {
			options?.onStarted?.();
			throw new Error( 'Disk full' );
		} );
		const queryClient = createTestQueryClient();
		const view = renderHook( useExport, {
			wrapper: ( { children }: { children: ReactNode } ) => (
				<ConnectorProvider connector={ connector }>
					<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
				</ConnectorProvider>
			),
		} );
		await act( async () => {
			await expect( view.result.current.mutateAsync( 'site-1' ) ).rejects.toThrow( 'Disk full' );
		} );
		expect( getNoticeHistory() ).toHaveLength( 1 );
		expect( getVisibleToasts()[ 0 ] ).toMatchObject( { title: failure, intent: 'error' } );
	}
);
