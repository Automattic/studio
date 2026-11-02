import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLoadingStage } from './use-loading-stage';

const stopped = {
	siteId: 'site',
	live: false,
	canPreview: false,
	isStarting: false,
	design: false,
};

function renderStage( initialProps: typeof stopped ) {
	return renderHook( ( props ) => useLoadingStage( props ), { initialProps } );
}

describe( 'useLoadingStage', () => {
	it( 'holds the stage over a started site until its first page arrives', () => {
		const { result, rerender } = renderStage( stopped );

		rerender( { ...stopped, isStarting: true } );
		rerender( { ...stopped, canPreview: true } );
		expect( result.current.loadingStage ).toBe( true );

		act( () => result.current.reveal() );
		expect( result.current.loadingStage ).toBe( false );
	} );

	it( 'keeps the page showing when a site that is already up is started again', () => {
		const running = { ...stopped, canPreview: true };
		const { result, rerender } = renderStage( running );

		rerender( { ...running, isStarting: true } );
		rerender( running );

		expect( result.current.loadingStage ).toBe( false );
	} );
} );
