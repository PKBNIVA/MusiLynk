# Weekly: builds and sends "This week on MusiLynk" to every active, email-eligible user
# (WeeklyDigest builds the sections). Idempotent per user per ISO week via the
# lifecycle_emails table (key "digest:<ISO week>"), so a retried or re-triggered run never
# double-sends. Runs Tuesday 09:30 IST (04:00 UTC) — see config/initializers/good_job.rb.
class WeeklyDigestJob < ApplicationJob
  queue_as :scheduled

  def perform(now = Time.current)
    since = now - 7.days
    key = LifecycleEmail.digest_key(now)
    # Synthetic QA and demo accounts never get e-mail.
    User.organic.where(status: "active").where(role: %w[jobseeker employer]).find_each do |user|
      next if LifecycleEmail.sent?(user, key)
      next unless NotificationEmail.deliverable_to?(user, category: "digest")

      sections = WeeklyDigest.build(user, since:, until_time: now)
      next if sections.all? { |s| Array(s[:items]).blank? } && sections.none? { |s| s[:footnote].present? }
      next unless LifecycleEmail.record!(user, key)

      WeeklyDigestDeliveryJob.perform_later(user.id, sections.as_json, WeeklyDigest.subject_for(sections))
    end
  end
end
