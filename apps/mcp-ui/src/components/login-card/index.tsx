import { useState } from 'react';
import { useConnector } from '@/data/core';
import { useLogIn } from '@/data/queries/use-host-actions';

// WordPress.com shows a token after the user authorizes Studio; they paste it here.
export function LoginCard() {
	const connector = useConnector();
	const logIn = useLogIn();
	const [ opened, setOpened ] = useState( false );
	const [ opening, setOpening ] = useState( false );
	const [ token, setToken ] = useState( '' );

	const openAuthorization = async () => {
		setOpening( true );
		try {
			await connector.openLink( await connector.readLoginUrl() );
			setOpened( true );
		} finally {
			setOpening( false );
		}
	};

	return (
		<div className="empty">
			<p className="empty-title">Log in to WordPress.com</p>
			{ opened ? (
				<>
					<p>Approve access in your browser, then paste the token WordPress.com shows you.</p>
					<form
						className="login-form"
						onSubmit={ ( event ) => {
							event.preventDefault();
							if ( token.trim() ) {
								logIn.mutate( token );
							}
						} }
					>
						<input
							className="input"
							type="password"
							autoComplete="off"
							aria-label="WordPress.com token"
							placeholder="Paste the token"
							value={ token }
							onChange={ ( event ) => setToken( event.target.value ) }
						/>
						<button
							type="submit"
							data-kind="primary"
							disabled={ ! token.trim() || logIn.isPending }
						>
							{ logIn.isPending ? 'Connecting…' : 'Connect' }
						</button>
					</form>
					{ logIn.isError && <p className="login-error">{ logIn.error.message }</p> }
					<button type="button" data-kind="quiet" data-size="sm" onClick={ openAuthorization }>
						Open the WordPress.com page again
					</button>
				</>
			) : (
				<>
					<p>See your WordPress.com sites here, publish to them and pull them into Studio.</p>
					<div className="actions">
						<button
							type="button"
							data-kind="primary"
							disabled={ opening }
							onClick={ openAuthorization }
						>
							Log in
						</button>
					</div>
				</>
			) }
		</div>
	);
}
