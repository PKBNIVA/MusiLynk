# Who a signed-in person is acting as right now: themselves, or a Page they run.
# A Page is an organization (studio, label, venue, agency…) where they are owner or admin,
# or an act (band, ensemble…) they own. Everything that can be done "as a Page" (posting jobs,
# posts, bookings) resolves the actor through here, so the permission rule lives in one place.
class ActorResolver
  TYPES = %w[user organization act].freeze
  MANAGING_ROLES = %w[owner admin].freeze

  Actor = Data.define(:type, :id, :name, :record, :user) do
    def user? = type == "user"
    def key = "#{type}:#{id}"
    def as_json(*) = { type:, id:, name:, key: }
  end

  def self.identities_for(user)
    [personal(user)] +
      Organization.joins(:organization_members)
        .where(status: "active", organization_members: { user_id: user.id, role: MANAGING_ROLES })
        .order(:name).map { |org| Actor.new(type: "organization", id: org.id, name: org.name, record: org, user:) } +
      Act.where(owner_id: user.id).where.not(status: "hidden").order(:name)
        .map { |act| Actor.new(type: "act", id: act.id, name: act.name, record: act, user:) }
  end

  # Returns the actor, or nil when the key is malformed or the user may not act as it.
  def self.resolve(user, key)
    return personal(user) if key.blank?

    type, id = key.to_s.split(":", 2)
    return nil unless TYPES.include?(type) && id.present?
    return (id == user.id ? personal(user) : nil) if type == "user"

    identities_for(user).find { |actor| actor.type == type && actor.id == id }
  end

  def self.personal(user) = Actor.new(type: "user", id: user.id, name: user.name, record: user, user:)
end
