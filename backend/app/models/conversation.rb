class Conversation < ApplicationRecord
  belongs_to :candidate, class_name: "User"
  belongs_to :employer, class_name: "User"
  belongs_to :job, optional: true
  has_many :messages, dependent: :destroy

  # One thread per hirer-musician pair (J-19). The first call creates it; later ones, for the same or
  # another opportunity, reuse it and move its opportunity context to the latest one named. Rows
  # created before this rule (one per opportunity) stay readable and are found by pair, newest first.
  def self.open_between!(candidate:, employer:, job: nil)
    # Either way round: a musician who also hires can be on the employer side of an older thread.
    pair = where(candidate:, employer:).or(where(candidate: employer, employer: candidate))
    existing = (job && pair.find_by(job:)) || pair.order(updated_at: :desc).first
    return create!(candidate:, employer:, job:) unless existing

    existing.update!(job:) if job && existing.job_id != job.id
    existing
  rescue ActiveRecord::RecordNotUnique
    pair.order(updated_at: :desc).first!
  end

  def includes_user?(user) = candidate_id == user.id || employer_id == user.id

  # The other participant, decided by which side `user` is on (never by account role).
  def counterpart_for(user) = candidate_id == user.id ? employer : candidate
end
