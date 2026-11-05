// Loaded explicitly by the isolated browser test. Never imported by production code.
import {createProviderFixture} from "./provider-fixture.mjs";
const fixture = await createProviderFixture();
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => /^https:\/\/(oauth2\.googleapis\.com|www\.googleapis\.com|github\.com|api\.github\.com)\//.test(String(url))
	? fixture.fetcher(url, options) : originalFetch(url, options);
