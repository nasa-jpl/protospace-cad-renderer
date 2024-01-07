import { GithubLfsResolver } from './GithubLfsResolver.js';

const resolver = new GithubLfsResolver();
resolver.pagesStem = location.origin + '/protospace-cad-renderer';
resolver.targetStem = 'https://media.githubusercontent.com/media';
resolver.branch = 'main';
resolver.repo = 'protospace-cad-renderer';
resolver.org = 'nasa-jpl';

export function lfsFetch( url, options ) {

	if ( /github.io/.test( location.href ) ) {

		url = resolver.resolve( url );

	}

	return fetch( url, options );

}
