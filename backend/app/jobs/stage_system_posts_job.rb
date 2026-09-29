# Posts the platform's own updates to The Stage as the "Verse" system author (Post.author_type
# "system"). Runs hourly (config/initializers/good_job.rb); every event it posts is idempotent
# via a unique `system_ref`, keyed off a fixed one-hour bucket ending at the top of the current
# hour — re-running the same bucket (a retry, or calling the job by hand) always computes the
# same refs, so it can never double-post even without a "have I already looked at this" check.
class StageSystemPostsJob < ApplicationJob
  queue_as :scheduled

  # Above this many completions in the bucket, post one aggregate instead of one post each.
  WELCOME_AGGREGATE_THRESHOLD = 5
  IST = ActiveSupport::TimeZone["Asia/Kolkata"]

  def perform(now = Time.current)
    bucket_end = now.beginning_of_hour
    bucket_start = bucket_end - 1.hour

    post_welcomes(bucket_start, bucket_end)
    post_verifications(bucket_start, bucket_end)
    post_urgent_fills(bucket_start, bucket_end)
    post_weekly_roundup(now)
  end

  private

  def post_welcomes(bucket_start, bucket_end)
    users = User.jobseeker.where(profile_complete: true, updated_at: bucket_start...bucket_end).includes(:profile)
    return if users.empty?

    if users.size > WELCOME_AGGREGATE_THRESHOLD
      roles = users.flat_map { Array(_1.profile&.roles) }.map(&:to_s).reject(&:blank?).uniq.first(3)
      suffix = roles.any? ? " — #{roles.join(', ')}#{roles.length < users.size ? '…' : ''}" : ""
      create_system_post!(ref: "welcome_aggregate:#{bucket_start.utc.iso8601}", system_kind: "welcome_aggregate",
        body: "#{users.size} musicians joined this week#{suffix}")
    else
      users.each do |user|
        profile = user.profile
        role = Array(profile&.roles).first || "musician"
        city = profile&.location.presence || "your city"
        create_system_post!(ref: "welcome:#{user.id}", system_kind: "welcome", city: profile&.location,
          body: "Welcome #{user.name.to_s.split.first}, #{role} in #{city}")
      end
    end
  end

  def post_verifications(bucket_start, bucket_end)
    Profile.joins(:user).where(verified: true, share_verification_publicly: true, updated_at: bucket_start...bucket_end).find_each do |profile|
      create_system_post!(ref: "verified:#{profile.user_id}", system_kind: "verified", city: profile.location,
        body: "#{profile.user.name} is now Verified")
    end
  end

  def post_urgent_fills(bucket_start, bucket_end)
    UrgentRequest.where(status: "filled", updated_at: bucket_start...bucket_end).find_each do |request|
      hours = [((request.updated_at - request.created_at) / 3600.0).round, 1].max
      create_system_post!(ref: "urgent_filled:#{request.id}", system_kind: "urgent_filled", city: request.city,
        body: "A #{request.role_name} request in #{request.city} was filled in #{hours} #{'hour'.pluralize(hours)}")
    end
  end

  # Every Monday 10:00 IST, a pinned post inviting the week's availability in comments. Checked
  # every hour; only fires in the run whose IST wall-clock hour is 10 on a Monday, and the ref
  # is keyed to that IST calendar day, so it fires at most once a week regardless of retries.
  def post_weekly_roundup(now)
    ist_now = now.in_time_zone(IST)
    return unless ist_now.monday? && ist_now.hour == 10

    day_key = ist_now.to_date.iso8601
    post = create_system_post!(ref: "weekly_roundup:#{day_key}", system_kind: "weekly_roundup",
      body: "This week: who's looking, who's free. Comment with your roles and free dates.")
    post&.update!(pinned_until: ist_now.end_of_day.in_time_zone("UTC") + 6.days)
  end

  # Returns the created post, or nil if this ref was already posted (including by a concurrent
  # run — the unique index on system_ref is the actual guarantee; this rescue just makes a
  # retry a no-op instead of an error).
  def create_system_post!(ref:, system_kind:, body:, city: nil)
    Post.create!(author_type: "system", author_id: Post::SYSTEM_AUTHOR_ID, kind: "system", system_kind:,
      system_ref: ref, body:, city:, visibility: "public", status: "active")
  rescue ActiveRecord::RecordNotUnique
    nil
  end
end
