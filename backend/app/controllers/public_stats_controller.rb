# GET /api/public/stats — real counts for the landing page: verified professionals, the cities
# they work from, and open opportunities. Synthetic QA and demo accounts are never counted, so
# the numbers are never inflated. Cached for five minutes.
class PublicStatsController < ApplicationController
  CACHE_TTL = 5.minutes

  def show
    expires_in CACHE_TTL, public: true
    render json: Rails.cache.fetch("public-stats:v1", expires_in: CACHE_TTL) { compute }
  end

  private

  def compute
    talent = User.discoverable_talent.organic.joins(:profile)
    city = "NULLIF(lower(trim(split_part(profiles.location, ',', 1))), '')"
    now = Time.current
    {
      verifiedProfiles: talent.where(profiles: { verified: true }).count,
      professionals: talent.count,
      cities: talent.distinct.count(Arel.sql(city)),
      openOpportunities: Job.published.joins(:employer).merge(User.organic)
        .where("jobs.application_deadline IS NULL OR jobs.application_deadline >= ?", now).count,
      urgentRequests: UrgentRequest.where(status: "open").where("urgent_requests.start_at >= ?", now)
        .joins(:requester).merge(User.organic).count,
      generatedAt: now.iso8601
    }
  end
end
