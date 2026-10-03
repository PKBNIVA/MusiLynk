import { apiGet } from './api';
import type { SearchSuggestResponse } from './apiTypes';

/** Type-ahead for the search boxes (GET /search/suggest). Cached for a minute by the API and the browser. */
export function searchSuggest(query: string, signal?: AbortSignal): Promise<SearchSuggestResponse> {
  return apiGet<SearchSuggestResponse>(`/search/suggest?${new URLSearchParams({ q: query }).toString()}`, { signal });
}
