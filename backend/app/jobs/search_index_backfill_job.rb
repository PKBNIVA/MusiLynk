# Builds the search documents (Search::Document) of existing rows in batches: once after the
# migration that adds them, and nightly for rows written without model callbacks (missing_only).
# POST /api/admin/search/reindex enqueues a full rebuild. Safe to run twice.
class SearchIndexBackfillJob < ApplicationJob
  queue_as :scheduled

  def perform(missing_only: false, documents: Search::Indexer::DOCUMENTS.keys)
    counts = documents.index_with { Search::Indexer.backfill(_1, missing_only:) }
    # Hire pages enter the sitemap by counting matches on these documents; a sitemap built while
    # they were missing leaves pages out, so rebuild it now (the last good copy is served meanwhile).
    SitemapRefreshJob.perform_later if counts.values.any?(&:positive?)
    Rails.logger.info("[search] backfill #{missing_only ? 'missing' : 'all'}: #{counts.to_json}")
    counts
  end
end
