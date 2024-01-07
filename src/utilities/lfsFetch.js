import { GithubLfsResolver } from './GithubLfsResolver.js';

const resolver = new GithubLfsResolver();
resolver.pagesStem = location.origin;

export function lfsFetch( url, options ) {

	if ( /github.io/.test( location.href ) ) {

		url = resolver.resolve( url );

	}

	return fetch( url, options );

}
