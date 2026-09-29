# Backs the /hire/:role/:city landing pages and the popular-searches ranking: how many
# discoverable, discoverable-by-search professionals match a role and a city, using the exact
# same matching TalentController#public_index and the "Hire a drummer in Mumbai" landing links
# use (free-text role + free-text location), so a hire page's numbers always agree with what its
# own "Browse all" link finds.
module Seo
  class HireStats
    ROLE_FIELDS = TalentController::ROLE_FIELDS
    LOCATION_FIELDS = TalentController::LOCATION_FIELDS

    def self.scope_for(role_label, city_name)
      scope = User.discoverable_talent.organic.joins(:profile)
      scope = Search::Query.new(role_label).filter(scope, ROLE_FIELDS)
      Search::Query.new(city_name).filter(scope, LOCATION_FIELDS)
    end

    def self.counts_for(role_label, city_name)
      scope = scope_for(role_label, city_name)
      professionals = scope.count
      verified = scope.where(profiles: { verified: true }).count
      available_this_week = professionals.zero? ? 0 : available_this_week_count(scope)
      { professionals:, verified:, availableThisWeek: available_this_week }
    end

    def self.available_this_week_count(scope)
      AvailabilityWindow.where(user_id: scope.select(:id), status: "available")
        .where("start_at <= ?", 7.days.from_now).where("end_at >= ?", Time.current)
        .distinct.count(:user_id)
    end

    def self.featured_for(role_label, city_name, limit: 8)
      scope_for(role_label, city_name)
        .order(Arel.sql("profiles.verified DESC, users.created_at DESC, users.id ASC"))
        .limit(limit)
    end
  end
end
