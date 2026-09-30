class Job < ApplicationRecord
  belongs_to :employer, class_name: "User"
  # The Page the job is posted as (see posted_as_page). Two plain associations on the same key
  # instead of a polymorphic one, so listings can preload them and the stored type stays the
  # ActorResolver type ("organization"/"act") rather than a class name.
  belongs_to :posted_as_organization, class_name: "Organization", foreign_key: :posted_as_id, optional: true
  belongs_to :posted_as_act, class_name: "Act", foreign_key: :posted_as_id, optional: true
  has_many :applications, dependent: :destroy
  has_many :saved_jobs, dependent: :destroy
  has_many :job_alert_deliveries, dependent: :destroy

  attribute :skills, :json, default: -> { [] }
  attribute :languages, :json, default: -> { [] }
  attribute :screening_questions, :json, default: -> { [] }

  enum :status, { draft: "draft", pending: "pending", published: "published", rejected: "rejected", closed: "closed" }, validate: true
  validates :title, :company, presence: true
  validates :posted_as_type, inclusion: { in: PageDirectory::TYPES }, allow_nil: true
  validates :posted_as_id, presence: true, if: :posted_as_type
  validates :title, length: { maximum: 160 }
  # Drafts (and drafts that were closed) may be incomplete; a job is fully validated whenever it
  # is submitted for review or live.
  validates :location, presence: true, if: :listed?
  validates :description, length: { minimum: 60 }, if: :listed?
  # Upper bounds keep values inside the 32-bit integer columns (larger ones raise instead of validating).
  validates :slots, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 10_000 }, allow_nil: true
  validates :compensation_min, :compensation_max, numericality: { greater_than_or_equal_to: 0, less_than: 2**31 }, allow_nil: true
  validate :compensation_range_is_ordered
  validate :screening_questions_are_bounded
  validate :no_template_placeholders, if: :listed?

  # Adds an `applications_total` column computed by a correlated COUNT (served by the
  # applications(job_id, candidate_id) index) so listings never load application rows.
  scope :with_posted_as, -> { preload(:posted_as_organization, :posted_as_act) }
  scope :posted_as, ->(type, id) { where(posted_as_type: type, posted_as_id: id) }
  # Public listing only ("stale listings" complaint): a hirer who signed in more than 90 days
  # ago is unlikely to reply, so their otherwise-published jobs are hidden from the open
  # /music-jobs feed even though the listing itself stays reachable at its direct URL. A hirer
  # who has never signed in again since registering (last_login_at nil) is not treated as
  # inactive — there is no evidence either way, so their listing is not penalized.
  HIRER_INACTIVE_AFTER = 90.days
  scope :from_active_hirers, -> {
    joins(:employer).where("users.last_login_at IS NULL OR users.last_login_at >= ?", HIRER_INACTIVE_AFTER.ago)
  }

  scope :with_applications_count, -> {
    select(arel_table[Arel.star], "(SELECT COUNT(*) FROM applications WHERE applications.job_id = jobs.id) AS applications_total")
  }

  def applications_count
    has_attribute?(:applications_total) ? self[:applications_total].to_i : applications.count
  end

  # Columns anyone may see on a listing. Everything else (today: moderation_note, which holds
  # automated review hints and admin rejection reasons) is only for the owner and admins, so a
  # new internal column stays private unless it is added here.
  PUBLIC_COLUMNS = %w[
    id employer_id title company location kind genre salary description requirements skills languages
    screening_questions experience_level status opportunity_kind function_area workplace currency
    compensation_period duration compensation_min compensation_max slots featured paid portfolio_required
    application_deadline start_date published_at created_at updated_at posted_as_type posted_as_id
  ].freeze

  def visible_in_full_to?(viewer) = viewer.present? && (viewer.admin? || viewer.id == employer_id)

  # `viewer` is the signed-in user (or nil); owners and admins get every column.
  def api_json(viewer = nil)
    fields = visible_in_full_to?(viewer) ? attributes.except("applications_total") : attributes.slice(*PUBLIC_COLUMNS)
    fields.merge(
      "type" => kind,
      "portfolioRequired" => portfolio_required,
      "screeningQuestions" => screening_questions,
      "employerName" => employer.name,
      "employerVerified" => employer.profile&.verified || false,
      "demo" => SyntheticQa::Demo.user?(employer),
      "applicationsCount" => applications_count,
      "postedAs" => posted_as_json(viewer),
      "createdAt" => created_at,
      "updatedAt" => updated_at
    )
  end

  def listed? = pending? || published?

  # The organization or act this job is posted as, or nil for a personal post (or a Page that
  # no longer exists).
  def posted_as_page
    case posted_as_type
    when "organization" then posted_as_organization
    when "act" then posted_as_act
    end
  end

  # Sets (or, with a personal actor, clears) the Page this job is posted as.
  def posted_as_actor=(actor)
    page = actor.user? ? nil : actor.record
    self.posted_as_type = page && actor.type
    self.posted_as_id = page&.id
  end

  # {type, id, name} of the Page, or nil. Others only see a Page that is publicly visible; the
  # owner and admins always see what the job is attached to.
  def posted_as_json(viewer = nil)
    page = posted_as_page
    return nil unless page && (visible_in_full_to?(viewer) || PageDirectory.public?(page))
    PageDirectory.ref(posted_as_type, page)
  end

  private

  def compensation_range_is_ordered
    return if compensation_min.blank? || compensation_max.blank? || compensation_min <= compensation_max
    errors.add(:compensation_max, "must be at least the minimum")
  end

  # The post-opportunity templates mark the spots to fill in as {{like this}}. A draft may keep
  # them, but a listing that is submitted or live must not (J-02).
  TEMPLATE_PLACEHOLDER = "{{".freeze

  def no_template_placeholders
    %i[title description requirements].each do |attribute|
      errors.add(attribute, "still has a spot left to fill in") if self[attribute].to_s.include?(TEMPLATE_PLACEHOLDER)
    end
    errors.add(:screening_questions, "still have a spot left to fill in") if Array(screening_questions).any? { _1.to_s.include?(TEMPLATE_PLACEHOLDER) }
  end

  def screening_questions_are_bounded
    questions = Array(screening_questions)
    errors.add(:screening_questions, "are limited to 8") if questions.length > 8
    errors.add(:screening_questions, "must each be under 300 characters") if questions.any? { _1.to_s.length > 300 }
  end
end
