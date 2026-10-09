# The talent directory's ranking (plan 5.1.4), precomputed into profiles.rank_score so the list orders
# by an index on (rank_score DESC, user_id DESC) instead of scoring every row per request.
#
# The score is a packed integer, so comparing two scores compares the signals in priority order:
#   verified                                         10_000
#   a playable public sample (audio/video with a URL)  1_000
#   completeness (0-6, mirrors the dashboard score)    100 each
#   any published rate                                 10
#   recent sign-in: 7 days 3, 30 days 2, 90 days 1     1 each
# An empty profile therefore never outranks a populated one.
#
# Kept fresh by Profile and PortfolioItem callbacks (one UPDATE for the owner) and by the nightly
# TalentRankJob, which also ages the sign-in recency. Every path runs the same SQL (#update_sql).
module TalentRank
  HAS_SAMPLE_SQL = "EXISTS (SELECT 1 FROM portfolio_items ranked_samples WHERE ranked_samples.user_id = profiles.user_id AND ranked_samples.visibility = 'public' AND ranked_samples.kind IN ('audio', 'video') AND btrim(COALESCE(ranked_samples.url, '')) <> '')".freeze
  COMPLETENESS_SQL = [
    *%w[headline bio location].map { "(CASE WHEN btrim(COALESCE(profiles.#{_1}, '')) <> '' THEN 1 ELSE 0 END)" },
    *%w[skills genres].map { "(CASE WHEN profiles.#{_1} <> '[]'::jsonb THEN 1 ELSE 0 END)" },
    "(CASE WHEN EXISTS (SELECT 1 FROM portfolio_items scored_items WHERE scored_items.user_id = profiles.user_id) THEN 1 ELSE 0 END)"
  ].join(" + ").then { "(#{_1})" }.freeze
  HAS_RATES_SQL = "(LEAST(NULLIF(profiles.session_rate, 0), NULLIF(profiles.show_rate, 0), NULLIF(profiles.day_rate, 0), NULLIF(profiles.hourly_rate, 0)) IS NOT NULL)".freeze
  RECENCY_SQL = "(CASE WHEN users.last_login_at >= NOW() - INTERVAL '7 days' THEN 3 WHEN users.last_login_at >= NOW() - INTERVAL '30 days' THEN 2 " \
                "WHEN users.last_login_at >= NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END)".freeze
  SCORE_SQL = "((CASE WHEN profiles.verified THEN 10000 ELSE 0 END) + (CASE WHEN #{HAS_SAMPLE_SQL} THEN 1000 ELSE 0 END) + " \
              "#{COMPLETENESS_SQL} * 100 + (CASE WHEN #{HAS_RATES_SQL} THEN 10 ELSE 0 END) + #{RECENCY_SQL})".freeze

  module_function

  # One UPDATE that rewrites only the scores that changed; `user_ids` narrows it to those owners.
  def update_sql(user_ids = nil)
    owners = user_ids.nil? ? "" : " AND profiles.user_id IN (#{Array(user_ids).map { ActiveRecord::Base.connection.quote(_1.to_s) }.join(', ').presence || 'NULL'})"
    "UPDATE profiles SET rank_score = #{SCORE_SQL} FROM users WHERE users.id = profiles.user_id#{owners} AND profiles.rank_score IS DISTINCT FROM #{SCORE_SQL}"
  end

  # Recomputes the scores of `user_ids` (every profile when nil); returns the rows changed.
  def refresh!(user_ids = nil)
    return 0 if user_ids && Array(user_ids).compact.empty?
    ActiveRecord::Base.connection.exec_update(update_sql(user_ids && Array(user_ids).compact.uniq))
  end
end
