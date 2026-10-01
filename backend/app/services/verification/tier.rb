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

    # { user_id => "verified" | "verified_pro" } for the verified users among `users`, in three grouped
    # queries instead of the three per-user COUNTs `for` runs (a directory page lists 24 people at once).
    def batch(users)
      verified = users.select { _1.profile&.verified? }
      return {} if verified.empty?
      ids = verified.map(&:id)
      completed = Hash.new(0)
      UrgentRequest.where(status: "filled", filled_by_id: ids).group(:filled_by_id).count.each { |id, n| completed[id] += n }
      BookingRequest.where(status: "completed").joins(:act).where(acts: { owner_id: ids }).group("acts.owner_id").count.each { |id, n| completed[id] += n }
      reviews = Review.where(status: "published", employer_id: ids).group(:employer_id).count
      min_completed = Config.pro.fetch(:min_completed)
      min_reviews = Config.pro.fetch(:min_reviews)
      verified.to_h do |user|
        pro = completed[user.id] >= min_completed && reviews.fetch(user.id, 0) >= min_reviews
        [user.id, pro ? "verified_pro" : "verified"]
      end
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

    # User ids that qualify for Verified Pro, for the directory filter.
    def pro_user_ids
      fills = Hash.new(0)
      UrgentRequest.where(status: "filled").where.not(filled_by_id: nil).group(:filled_by_id).count.each { |id, n| fills[id] += n }
      BookingRequest.where(status: "completed").joins(:act).group("acts.owner_id").count.each { |id, n| fills[id] += n }
      reviewed = Review.where(status: "published").group(:employer_id).having("COUNT(*) >= ?", Config.pro.fetch(:min_reviews).to_i).count.keys
      fills.select { |_id, n| n >= Config.pro.fetch(:min_completed) }.keys & reviewed
    end
  end
end
