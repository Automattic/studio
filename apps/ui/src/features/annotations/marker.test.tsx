import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AnnotationMarker } from './marker';

afterEach( () => vi.useRealTimers() );

it( 'keeps the marker for its exit animation, then removes it', () => {
	const { container, rerender } = render( <AnnotationMarker number={ 1 } active /> );
	const marker = container.firstElementChild!;
	rerender( <AnnotationMarker number={ 1 } active={ false } /> );
	expect( marker ).toHaveAttribute( 'data-active', 'false' );
	fireEvent.animationEnd( marker );
	expect( container ).toBeEmptyDOMElement();
	rerender( <AnnotationMarker number={ 1 } active /> );
	expect( container.firstElementChild ).toHaveAttribute( 'data-active', 'true' );
} );

it( 'cancels pending removal when annotation mode is quickly reopened', () => {
	vi.useFakeTimers();
	const { container, rerender } = render( <AnnotationMarker number={ 1 } active /> );
	rerender( <AnnotationMarker number={ 1 } active={ false } /> );
	rerender( <AnnotationMarker number={ 1 } active /> );
	act( () => {
		vi.advanceTimersByTime( 250 );
	} );
	expect( container.firstElementChild ).toHaveAttribute( 'data-active', 'true' );
} );

it( 'shows rejection feedback only on the edited marker and clears it', () => {
	vi.useFakeTimers();
	const view = ( attempt: number ) => (
		<>
			<AnnotationMarker number={ 1 } editing blockedNavigation={ attempt } />
			<AnnotationMarker number={ 2 } blockedNavigation={ attempt } />
		</>
	);
	const { container, rerender } = render( view( 0 ) );
	rerender( view( 1 ) );
	expect( container.children[ 0 ] ).toHaveAttribute( 'data-feedback', 'shake' );
	expect( container.children[ 1 ] ).not.toHaveAttribute( 'data-feedback' );
	act( () => {
		vi.advanceTimersByTime( 360 );
	} );
	act( () => {
		vi.advanceTimersByTime( 600 );
	} );
	expect( container.children[ 0 ] ).not.toHaveAttribute( 'data-feedback' );
} );
