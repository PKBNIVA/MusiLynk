module Verification
  # Badge tiers: "verified" once a verification request is approved (profiles.verified), and
  # "verified_pro" when that person also has enough completed work on Verse: urgent requests
  # they filled or bookings of their acts that were completed, plus published reviews received
  # (thresholds in config/verification.yml `pro`).
  module Tier
    module_function

    def for(user)
      return nil unless user.profile&.verified?
      pro?(user) ? "verified_pro" : "verified"
    end

    def pro?(user)
      completed_count(user) >= Config.pro.fetch(:min_completed) && reviews_count(user) >= Config.pro.fetch(:min_reviews)
    end

    # Completed as the hired party: urgent requests filled by the user, completed bookings of acts they own.
    def completed_count(user)
      UrgentRequest.where(filled_by_id: user.id, status: "filled").count +
        BookingRequest.joins(:act).where(status: "completed", acts: { owner_id: user.id }).count
    end

    def reviews_count(user) = Review.where(employer_id: user.id, status: "published").count

    # User ids that qualify for Verified Pro, as a subquery for the directory filter.
    def pro_user_ids_sql
      min_completed = Config.pro.fetch(:min_completed).to_i
      min_reviews = Config.pro.fetch(:min_reviews).to_i
      <<~SQL.squish
        SELECT fills.user_id FROM (
          SELECT filled_by_id AS user_id FROM urgent_requests WHERE status = 'filled' AND filled_by_id IS NOT NULL
          UNION ALL
          SELECT acts.owner_id AS user_id FROM booking_requests JOIN acts ON acts.id = booking_requests.act_id WHERE booking_requests.status = 'completed'
        ) fills
        JOIN (SELECT employer_id AS user_id FROM reviews WHERE status = 'published' GROUP BY employer_id HAVING COUNT(*) >= #{min_reviews}) reviewed
          ON reviewed.user_id = fills.user_id
        GROUP BY fills.user_id HAVING COUNT(*) >= #{min_completed}
      SQL
    end
  end
end
