class Act < ApplicationRecord
  include SearchIndexed
  search_document "acts", fields: %i[name act_type genres event_types languages tagline bio city]
  belongs_to :owner, class_name: "User"
  has_many :act_members, dependent: :destroy
  has_many :act_invites, dependent: :destroy
  has_many :booking_requests, dependent: :destroy
  has_many :portfolios, -> { where(owner_type: "act") }, foreign_key: :owner_id, dependent: :destroy, inverse_of: false
  # Tagline that marks the hidden solo act created for quotes asked of a musician directly.
  DIRECT_ENQUIRY_TAGLINE = "Direct enquiries".freeze

  attribute :genres, :json, default: -> { [] }
  attribute :languages, :json, default: -> { [] }
  attribute :event_types, :json, default: -> { [] }
  validates :tech_rider_url, :hospitality_rider_url, :promo_url, :photo_url, safe_http_url: true, allow_blank: true
  validates :photo_url, length: { maximum: 500 }
  validates :name, :act_type, presence: true
  # "hidden" is never set or lifted by the owner. It is used for two things: an admin's
  # moderation (Admin::ReportsController#moderate) and the musician's own solo act that direct
  # quotes land on (BookingsController#solo_act_for; see .direct_enquiry). Both are excluded from
  # every public, search and booking query, which all ask for status "active".
  validates :status, inclusion: { in: %w[active inactive draft hidden] }
  validates :lineup_size, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :min_fee, :max_fee, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
  validate :fee_range_is_valid
  # The hidden solo act behind direct quotes: it is where those bookings live, but it is not an
  # act the musician manages, so it is left out of My acts.
  scope :direct_enquiry, -> { where(status: "hidden", act_type: "solo", tagline: DIRECT_ENQUIRY_TAGLINE) }

  def api_json = attributes.merge(members: act_members.map(&:api_json), ownerName: owner.name, ownerVerified: owner.profile&.verified || false, demo: SyntheticQa::Demo.user?(owner))
  def public_json
    attributes.except("owner_id", "tech_rider_url", "hospitality_rider_url").merge(
      members: act_members.select { _1.member_status == "confirmed" }.map(&:public_json),
      ownerName: owner.name,
      ownerVerified: owner.profile&.verified || false,
      demo: SyntheticQa::Demo.user?(owner)
    )
  end

  private

  def fee_range_is_valid
    errors.add(:max_fee, "must be at least the minimum fee") if min_fee && max_fee && max_fee < min_fee
  end
end
