import { useState } from 'react';
import { useLogIn, useOpenLogin } from '@/data/queries/use-host-actions';

// WordPress.com shows a token once the user authorizes Studio; they paste it here.
export function LoginCard() {
	const openLogin = useOpenLogin();
	const logIn = useLogIn();
	const [ token, setToken ] = useState( '' );
	const error = openLogin.error || logIn.error;

	return (
		<div className="empty">
			<p className="empty-title">Log in to WordPress.com</p>
			{ openLogin.isSuccess ? (
				<>
					<p>Approve access in your browser, then paste the token WordPress.com shows you.</p>
					<form
						className="login-form"
						onSubmit={ ( event ) => {
							event.preventDefault();
							logIn.mutate( token );
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
				</>
			) : (
				<>
					<p>See your WordPress.com sites here, publish to them and pull them into Studio.</p>
					<div className="actions">
						<button
							type="button"
							data-kind="primary"
							disabled={ openLogin.isPending }
							onClick={ () => openLogin.mutate() }
						>
							Log in
						</button>
					</div>
				</>
			) }
			{ error && <p className="login-error">{ error.message }</p> }
		</div>
	);
}
