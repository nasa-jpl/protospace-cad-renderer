import { GithubLfsResolver } from './GithubLfsResolver.js';

const resolver = new GithubLfsResolver();
resolver.pagesStem = location.origin + '/protospace-cad-renderer';
resolver.targetStem = 'https://media.githubusercontent.com/media';
resolver.branch = 'main';
resolver.repo = 'protospace-cad-renderer';
resolver.org = 'nasa-jpl';

export function resolveLfsUrl( url ) {

	if ( /github.io/.test( location.href ) ) {

		return resolver.resolve( url );

	}

	return url;

}

export function lfsFetch( url, options ) {

	url = resolveLfsUrl( url );
	return fetch( url, options );

}
