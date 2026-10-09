# Nightly: recomputes profiles.rank_score for every profile (TalentRank). The callbacks keep scores
# fresh as profiles and samples change; this pass ages the sign-in recency and repairs any drift.
# Only rows whose score changed are written.
class TalentRankJob < ApplicationJob
  queue_as :default

  def perform
    changed = TalentRank.refresh!
    Rails.logger.info({ event: "talent_rank_refreshed", changed: }.to_json)
  end
end
