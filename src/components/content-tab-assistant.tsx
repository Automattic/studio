import React, { useState, useEffect, useRef } from 'react';
import { AssistantIcon } from './icons/assistant';
import { MenuIcon } from './icons/menu';

interface ContentTabAssistantProps {
	selectedSite: SiteDetails;
}
export const UserMessage = ( { text }: { text: string } ) => (
	<div className="flex justify-end mb-2 mt-2">
		<div className="inline-block p-2 rounded-sm border border-gray-300 lg:max-w-max user-select-text">{ text }</div>
	</div>
);

export const ResponseMessage = ( { text }: { text: string } ) => (
	<div className="flex justify-start mb-2 mt-2">
		<div className="inline-block p-2 rounded-sm border border-gray-300 bg-white lg:max-w-max user-select-text">
			{ text }
		</div>
	</div>
);

export function ContentTabAssistant( { selectedSite }: ContentTabAssistantProps ) {
	const [ messages, setMessages ] = useState< { text: string; isUser: boolean }[] >( [] );
	const [ input, setInput ] = useState< string >( '' );
	const endOfMessagesRef = useRef< HTMLDivElement >( null );

	const simulatedResponses = [
		'Welcome to the Studio assistant. I can help manage your site, debug issues, and navigate your way around the WordPress ecosystem.',
		'What can I help you with today?',
		"To install the Jetpack plugin in WordPress, you can follow these steps: \n\n1. Log in to your WordPress admin dashboard. \n2. Go to 'Plugins' > 'Add New'. \n3. In the search bar, type 'Jetpack' and press Enter. \n4. Find the Jetpack plugin in the search results (it should be the first one) and click 'Install Now'. \n5. After the plugin is installed, click 'Activate'.",
		'If you prefer to install it via WP-CLI, you can do so with the following command: wp plugin install jetpack --activate',
		"After installing and activating Jetpack, you'll need to connect it to a WordPress.com account. \nThis is necessary because Jetpack uses the WordPress.com infrastructure to provide many of its features. You can do this from the Jetpack settings page in your WordPress admin dashboard.",
	];

	useEffect( () => {
		const savedMessages = localStorage.getItem( selectedSite.name );
		if ( savedMessages ) {
			setMessages( JSON.parse( savedMessages ) );
		} else {
			setMessages( [] );
		}
	}, [ selectedSite ] );

	useEffect( () => {
		localStorage.setItem( selectedSite.name, JSON.stringify( messages ) );
	}, [ messages, selectedSite.name ] );

	const handleSend = () => {
		if ( input.trim() ) {
			setMessages( [ ...messages, { text: input, isUser: true } ] );
			setInput( '' );
			simulateResponse();
		}
	};

	const handleKeyDown = ( e: React.KeyboardEvent< HTMLInputElement > ) => {
		if ( e.key === 'Enter' ) {
			handleSend();
		}
	};

	const clearInput = () => {
		setInput( '' );
	};

	const simulateResponse = () => {
		const randomResponse =
			simulatedResponses[ Math.floor( Math.random() * simulatedResponses.length ) ];
		setTimeout( () => {
			setMessages( ( prevMessages ) => [
				...prevMessages,
				{ text: randomResponse, isUser: false },
			] );
		}, 1000 );
	};

	useEffect( () => {
		if ( endOfMessagesRef.current ) {
			endOfMessagesRef.current.scrollIntoView( { behavior: 'smooth' } );
		}
	}, [ messages ] );

	return (
		<div className="h-full flex flex-col bg-gray-50">
			<div className="flex-1 p-4 mb-4 overflow-auto">
				<div className="text-gray-500 mb-4">
					Welcome to the Studio assistant. I can help manage your site, debug issues, and navigate
					your way around the WordPress ecosystem.
				</div>
				<div>
					{ messages.map( ( message, index ) => (
						<div key={ index }>
							{ message.isUser ? (
								<UserMessage text={ message.text } />
							) : (
								<ResponseMessage text={ message.text } />
							) }
						</div>
					) ) }
					<div ref={ endOfMessagesRef } />
				</div>
			</div>
			<div className="flex items-center mb-4">
				<div className="relative flex-1">
					<input
						type="text"
						placeholder="Ask Studio WordPress Assistant"
						className="w-full p-2 rounded-lg border-black border ltr:pl-8 rtl:pr-8"
						value={ input }
						onChange={ ( e ) => setInput( e.target.value ) }
						onKeyDown={ handleKeyDown }
					/>
					<div className="absolute top-1/2 transform -translate-y-1/2 ltr:left-3 rtl:left-auto rtl:right-3 pointer-events-none">
						<AssistantIcon />
					</div>
				</div>
				<button aria-label="menu" className="ml-2 cursor-pointer" onClick={ clearInput }>
					<MenuIcon />
				</button>
			</div>
		</div>
	);
}
