import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { SyncGutter } from './sync-gutter';

describe( 'SyncGutter', () => {
	it( 'renders "Push to Production" and "Pull from Production" for local↔prod', () => {
		render(
			<SyncGutter
				from={ { kind: 'local', label: 'Local' } }
				to={ { kind: 'remote', label: 'Production' } }
				lastPushTimestamp={ null }
				lastPullTimestamp={ null }
				onPush={ () => {} }
				onPull={ () => {} }
			/>
		);
		expect( screen.getByRole( 'button', { name: /Push to Production/ } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /Pull from Production/ } ) ).toBeInTheDocument();
	} );

	it( 'uses generic push/pull labels between two remotes', () => {
		render(
			<SyncGutter
				from={ { kind: 'remote', label: 'Production' } }
				to={ { kind: 'remote', label: 'Staging' } }
				lastPushTimestamp={ null }
				lastPullTimestamp={ null }
				onPush={ () => {} }
				onPull={ () => {} }
			/>
		);
		expect( screen.getByRole( 'button', { name: /Push to Staging/ } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /Pull from Staging/ } ) ).toBeInTheDocument();
	} );
} );
