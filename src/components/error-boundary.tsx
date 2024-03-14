import * as Sentry from '@sentry/electron/renderer';
import { Component } from 'react';
import DefaultErrorFallback from './default-error-fallback';

interface ErrorLoggerProps {
	children: React.ReactNode;
	fallback?: React.ReactNode;
}

export default class ErrorBoundary extends Component< ErrorLoggerProps > {
	state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch( error: Error, info: React.ErrorInfo ) {
		// Error will be written to log by the main process
		console.error( error, info.componentStack );
		Sentry.captureException( error );
	}

	private promiseRejectionHandler = ( event: PromiseRejectionEvent ) => {
		this.setState( {
			hasError: true,
		} );
		Sentry.captureException( event.reason );
	};

	componentDidMount() {
		// Add an event listener to the window to catch unhandled promise rejections & stash the error in the state
		window.addEventListener( 'unhandledrejection', this.promiseRejectionHandler );
	}

	componentWillUnmount() {
		window.removeEventListener( 'unhandledrejection', this.promiseRejectionHandler );
	}

	render() {
		if ( this.state.hasError ) {
			return this.props.fallback || <DefaultErrorFallback />;
		}

		return this.props.children;
	}
}
