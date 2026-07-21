import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	useInstallAllWordPressSkills,
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
	useInstallAllWordPressSkills: vi.fn(),
	useInstallWordPressSkill: vi.fn(),
	useRemoveWordPressSkill: vi.fn(),
	useWordPressSkills: vi.fn(),
} ) );

const useInstallAllWordPressSkillsMock = vi.mocked( useInstallAllWordPressSkills );
const useInstallWordPressSkillMock = vi.mocked( useInstallWordPressSkill );
const useRemoveWordPressSkillMock = vi.mocked( useRemoveWordPressSkill );
const useWordPressSkillsMock = vi.mocked( useWordPressSkills );

describe( 'SkillsPanel', () => {
	const installSkillMutate = vi.fn();
	const installAllSkillsMutate = vi.fn();
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
		useInstallAllWordPressSkillsMock.mockReturnValue( {
			mutate: installAllSkillsMutate,
			isPending: false,
			error: null,
		} as never );
		useRemoveWordPressSkillMock.mockReturnValue( {
			mutate: removeSkillMutate,
			isPending: false,
			error: null,
		} as never );
	} );

	it( 'renders the intro copy and a toggle per skill reflecting installed state', () => {
		render( <SkillsPanel /> );

		expect( screen.getByRole( 'heading', { name: 'Skills' } ) ).toBeInTheDocument();
		expect(
			screen.getByText(
				/Skills are reusable instructions that teach agents how to complete specialized WordPress tasks/
			)
		).toBeInTheDocument();
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

	it( 'installs all uninstalled skills through the header button', () => {
		render( <SkillsPanel /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Install all' } ) );

		expect( installAllSkillsMutate ).toHaveBeenCalledWith( [ 'wp-rest-api' ] );
	} );

	it( 'hides the install-all button when every skill is installed', () => {
		useWordPressSkillsMock.mockReturnValue( {
			data: [
				{
					id: 'studio-cli',
					displayName: 'Studio CLI',
					description: 'Manage sites from the command line.',
					installed: true,
				},
			],
			isLoading: false,
			error: null,
		} as never );

		render( <SkillsPanel /> );

		expect( screen.queryByRole( 'button', { name: 'Install all' } ) ).not.toBeInTheDocument();
	} );

	it( 'disables the toggles and shows progress while installing all', () => {
		useInstallAllWordPressSkillsMock.mockReturnValue( {
			mutate: installAllSkillsMutate,
			isPending: true,
			error: null,
		} as never );

		render( <SkillsPanel /> );

		expect( screen.getByRole( 'checkbox', { name: 'Studio CLI' } ) ).toBeDisabled();
		expect( screen.getByRole( 'checkbox', { name: 'WP REST API' } ) ).toBeDisabled();
		expect( screen.getByRole( 'button', { name: 'Installing all skills' } ) ).toBeDisabled();
	} );

	it( 'keeps the toggles and install-all button enabled during a single-skill mutation', () => {
		useRemoveWordPressSkillMock.mockReturnValue( {
			mutate: removeSkillMutate,
			isPending: true,
			variables: 'studio-cli',
			error: null,
		} as never );

		render( <SkillsPanel /> );

		expect( screen.getByRole( 'checkbox', { name: 'Studio CLI' } ) ).toBeEnabled();
		expect( screen.getByRole( 'checkbox', { name: 'WP REST API' } ) ).toBeEnabled();
		expect( screen.getByRole( 'button', { name: 'Install all' } ) ).toBeEnabled();
	} );

	it( 'shows the loading state', () => {
		useWordPressSkillsMock.mockReturnValue( {
			data: undefined,
			isLoading: true,
			error: null,
		} as never );

		render( <SkillsPanel /> );

		expect( screen.getByText( 'Loading skills…' ) ).toBeInTheDocument();
	} );

	it( 'shows the empty state when no skills exist', () => {
		useWordPressSkillsMock.mockReturnValue( {
			data: [],
			isLoading: false,
			error: null,
		} as never );

		render( <SkillsPanel /> );

		expect( screen.getByText( 'No skills are available.' ) ).toBeInTheDocument();
	} );

	it( 'surfaces query errors inline', () => {
		useWordPressSkillsMock.mockReturnValue( {
			data: undefined,
			isLoading: false,
			error: new Error( 'Failed to load skills' ),
		} as never );

		render( <SkillsPanel /> );

		expect( screen.getByText( 'Failed to load skills' ) ).toBeInTheDocument();
	} );
} );
