import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	useSetAllWordPressSkills,
	useInstallWordPressSkill,
	useRemoveWordPressSkill,
	useWordPressSkills,
} from '@/data/queries/use-wordpress-skills';
import { SkillsPanel } from './skills-panel';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

vi.mock( '@wordpress/components', () => ( {
	FormToggle: ( props: {
		checked: boolean;
		disabled?: boolean;
		'aria-label'?: string;
		onChange: () => void;
	} ) => (
		<input
			type="checkbox"
			aria-label={ props[ 'aria-label' ] }
			checked={ props.checked }
			disabled={ props.disabled }
			onChange={ props.onChange }
		/>
	),
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Button: ( {
		children,
		loading,
		loadingAnnouncement,
		tone,
		variant,
		size,
		...props
	}: ButtonHTMLAttributes< HTMLButtonElement > & {
		children?: ReactNode;
		loading?: boolean;
		loadingAnnouncement?: string;
		tone?: string;
		variant?: string;
		size?: string;
	} ) => {
		void tone;
		void variant;
		void size;
		return <button { ...props }>{ loading ? loadingAnnouncement : children }</button>;
	},
} ) );

vi.mock( '@/components/learn-more', () => ( {
	LearnMoreLink: () => <button type="button">Learn more</button>,
} ) );

vi.mock( '@/data/queries/use-wordpress-skills', () => ( {
	useSetAllWordPressSkills: vi.fn(),
	useInstallWordPressSkill: vi.fn(),
	useRemoveWordPressSkill: vi.fn(),
	useWordPressSkills: vi.fn(),
} ) );

const useSetAllWordPressSkillsMock = vi.mocked( useSetAllWordPressSkills );
const useInstallWordPressSkillMock = vi.mocked( useInstallWordPressSkill );
const useRemoveWordPressSkillMock = vi.mocked( useRemoveWordPressSkill );
const useWordPressSkillsMock = vi.mocked( useWordPressSkills );

describe( 'SkillsPanel', () => {
	const installSkillMutate = vi.fn();
	const setAllSkillsMutate = vi.fn();
	const removeSkillMutate = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		useWordPressSkillsMock.mockReturnValue( {
			data: [
				{
					id: 'studio-cli',
					displayName: 'Studio CLI',
					description: 'Manage sites from the command line.',
					installed: true,
				},
				{
					id: 'wp-rest-api',
					displayName: 'WP REST API',
					description: 'Query WordPress content over REST.',
					installed: false,
				},
			],
			isLoading: false,
			error: null,
		} as never );
		useInstallWordPressSkillMock.mockReturnValue( {
			mutate: installSkillMutate,
			isPending: false,
			error: null,
		} as never );
		useSetAllWordPressSkillsMock.mockReturnValue( {
			mutate: setAllSkillsMutate,
			isPending: false,
			error: null,
		} as never );
		useRemoveWordPressSkillMock.mockReturnValue( {
			mutate: removeSkillMutate,
			isPending: false,
			error: null,
		} as never );
	} );

	it( 'shows a toggle per skill reflecting its installed state', () => {
		render( <SkillsPanel /> );

		expect( screen.getByRole( 'checkbox', { name: 'Studio CLI' } ) ).toBeChecked();
		expect( screen.getByRole( 'checkbox', { name: 'WP REST API' } ) ).not.toBeChecked();
	} );

	it( 'installs on toggling an uninstalled skill and removes on toggling an installed one', () => {
		render( <SkillsPanel /> );

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'WP REST API' } ) );
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Studio CLI' } ) );

		expect( installSkillMutate ).toHaveBeenCalledWith( 'wp-rest-api' );
		expect( removeSkillMutate ).toHaveBeenCalledWith( 'studio-cli' );
	} );

	it( 'turns every installed skill off from the WordPress skills switch', () => {
		render( <SkillsPanel /> );

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'WordPress skills' } ) );

		expect( setAllSkillsMutate ).toHaveBeenCalledWith( {
			skillIds: [ 'studio-cli' ],
			installed: false,
		} );
	} );

	it( 'surfaces query errors inline', () => {
		useWordPressSkillsMock.mockReturnValue( {
			data: [],
			isLoading: false,
			error: new Error( 'Failed to load skills' ),
		} as never );

		render( <SkillsPanel /> );

		expect( screen.getByText( 'Failed to load skills' ) ).toBeInTheDocument();
	} );
} );
