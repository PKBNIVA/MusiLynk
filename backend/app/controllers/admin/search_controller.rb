module Admin
  class SearchController < BaseController
    # Rebuilds every search document in the background (SearchIndexBackfillJob) and answers at once
    # with how many listed jobs and professionals there are (`indexed` is kept for older admin builds).
    def reindex
      SearchIndexBackfillJob.perform_later
      count = Job.published.count + User.jobseeker.active.where(profile_complete: true).count
      render json: { count:, indexed: count, provider: "postgresql" }
    end
  end
end
