# GET /api/public/stats — counts for the landing page: verified professionals, the cities they work
# from, and open opportunities. The top-level numbers are organic: synthetic QA and demo accounts are
# never counted, so the landing counters are never inflated. `listed` repeats the same numbers as a
# visitor browsing the directory would find them (badged demo accounts included); no page reads it yet,
# it is there for a directory-side counter so the landing numbers never have to change. Cached for five
# minutes.
class PublicStatsController < ApplicationController
  CACHE_TTL = 5.minutes

  def show
    expires_in CACHE_TTL, public: true
    render json: Rails.cache.fetch("public-stats:v2", expires_in: CACHE_TTL) { compute }
  end

  private

  def compute
    now = Time.current
    counts(now, organic: true).merge(listed: counts(now, organic: false), generatedAt: now.iso8601)
  end

  def counts(now, organic:)
    visible = ->(scope) { organic ? scope.merge(User.organic) : SyntheticQa::Demo.publicly_listed(scope) }
    talent = visible.call(User.discoverable_talent).joins(:profile)
    city = "NULLIF(lower(trim(split_part(profiles.location, ',', 1))), '')"
    {
      verifiedProfiles: talent.where(profiles: { verified: true }).count,
      professionals: talent.count,
      cities: talent.distinct.count(Arel.sql(city)),
      openOpportunities: visible.call(Job.published.joins(:employer))
        .where("jobs.application_deadline IS NULL OR jobs.application_deadline >= ?", now).count,
      urgentRequests: visible.call(UrgentRequest.where(status: "open").where("urgent_requests.start_at >= ?", now).joins(:requester)).count
    }
  end
end
