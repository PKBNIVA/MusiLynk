class Application < ApplicationRecord
  STATUS_TRANSITIONS = {
    "Applied" => ["Under Review", "Shortlisted", "Rejected"],
    "Under Review" => ["Shortlisted", "Interview Scheduled", "Rejected"],
    "Shortlisted" => ["Interview Scheduled", "Offer", "Rejected"],
    "Interview Scheduled" => ["Offer", "Rejected"],
    "Offer" => ["Hired", "Rejected"],
    "Rejected" => [],
    "Hired" => []
  }.freeze

  belongs_to :job
  belongs_to :candidate, class_name: "User"
  # What the applicant chose to send; materials_snapshot is the copy the employer sees.
  belongs_to :portfolio, optional: true
  belongs_to :resume, optional: true
  attribute :screening_answers, :json, default: -> { [] }
  validates :candidate_id, uniqueness: { scope: :job_id }
  validates :status, inclusion: { in: STATUS_TRANSITIONS.keys }
  validates :recruiter_rating, inclusion: { in: 1..5 }, allow_nil: true
  has_many :application_events, dependent: :destroy

  def can_transition_to?(next_status)
    STATUS_TRANSITIONS.fetch(status, []).include?(next_status)
  end

  # The portfolio (with its work samples) and resume exactly as they were when the application
  # was sent, so later edits or deletions never change what the employer sees.
  def self.materials_snapshot(portfolio, resume)
    return nil unless portfolio || resume
    {
      capturedAt: Time.current.iso8601,
      portfolio: portfolio && portfolio.api_json(members: portfolio.members)
        .slice(:id, :ownerType, :ownerId, :ownerName, :title, :purpose, :headline, :bio, :city, :genres, :rates, :slug, :itemCount, :items),
      resume: resume && resume.api_json(members: resume.members)
        .slice(:id, :title, :targetRole, :headline, :summary, :entryCount, :sections, :pdf).merge(uploadId: resume.upload_id)
    }.as_json
  end

  def api_json
    attributes.except("materials_snapshot").merge(jobId: job_id, portfolioId: portfolio_id, resumeId: resume_id, materials: materials_snapshot, coverLetter: cover_letter, interviewDate: interview_date,
      recruiterRating: recruiter_rating, recruiterNote: recruiter_note,
      createdAt: created_at, updatedAt: updated_at, screeningAnswers: screening_answers,
      opportunityKind: job.opportunity_kind, workplace: job.workplace,
      title: job.title, company: job.company, location: job.location)
  end
end
