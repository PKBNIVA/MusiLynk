require "test_helper"
require "rake"
require_relative "../synthetic_trace_assertions"

# T-08: a purge removes every row that belongs to a demo batch (including the tables it used to miss:
# posts, comments, reactions, follows, badges, review prompts, vouches, career entries, system posts...),
# never fails on a foreign key, and never touches real people or their own content.
class SyntheticQaPurgeTest < ActiveSupport::TestCase
  include SyntheticTraceAssertions

  BATCH = SyntheticQa::Demo::SHOWCASE_BATCH

  test "every table with a foreign key to users is handled by the purge" do
    connection = ActiveRecord::Base.lease_connection
    handled = SyntheticQa::BatchCleanup::HANDLED_USER_COLUMNS
    connection.tables.each do |table|
      connection.foreign_keys(table).select { _1.to_table == "users" }.each do |foreign_key|
        assert_includes handled.fetch(table, []), foreign_key.column.to_s, "#{table}.#{foreign_key.column} references users but the purge does not know about it"
      end
    end
  end

  test "the demo:showcase task seeds once, and a purge after Stage activity leaves nothing behind" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("demo:showcase")
    output, = capture_io { Rake::Task["demo:showcase"].invoke }
    assert_match(/seeded demo-showcase/, output)
    assert_equal 150, User.synthetic(BATCH).count

    Rake::Task["demo:showcase"].reenable
    output, = capture_io { Rake::Task["demo:showcase"].invoke }
    assert_match(/already exists \(150 accounts\); nothing to do/, output)
    assert_equal 150, User.synthetic(BATCH).count

    user_ids = User.synthetic(BATCH).pluck(:id)
    real = add_real_interactions
    add_platform_rows(user_ids, real)

    assert_equal 5, Post.where(author_type: "system").count
    result = SyntheticQa::BatchCleanup.call(batch: BATCH)

    assert_equal 150, result.users_removed
    assert_no_user_traces(user_ids)
    assert_no_leftovers(user_ids)
    assert real.fetch(:user).reload.present?
    assert Post.exists?(real.fetch(:post).id), "a real person's own post stays"
    assert_nil real.fetch(:reshare).reload.reshared_post_id, "a reshare of a removed post degrades instead of failing"
    assert_equal ["weekly_roundup"], Post.where(author_type: "system").pluck(:system_kind), "system posts that name a demo person go; the platform's own weekly post stays"
    assert_equal 0, SyntheticQa::Demo.users.count
    assert_equal 1, Job.count, "the real hirer's own listing stays"
    assert_equal 0, Application.count, "an application to a removed listing goes with it"
    assert_equal "closed", real.fetch(:request).reload.status
    assert_nil real.fetch(:request).filled_by_id

    again = SyntheticQa::BatchCleanup.call(batch: BATCH)
    assert_equal 0, again.users_removed
  end

  private

  def add_real_interactions
    user = User.create!(name: "Real Person", email: "real-purge@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", profile_complete: true)
    user.create_profile!(headline: "Real drummer")
    hirer = User.create!(name: "Real Hirer", email: "real-purge-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active", profile_complete: true)
    hirer.create_profile!(company_name: "Real Co")
    demo_post = Post.where(created_by_user_id: User.synthetic(BATCH).select(:id)).first
    demo_job = Job.where(employer_id: User.synthetic(BATCH).select(:id)).first
    demo_musician = User.synthetic(BATCH).jobseeker.first
    Application.create!(job: demo_job, candidate: user, status: "Applied")
    PostComment.create!(post: demo_post, author_type: "user", author_id: user.id, created_by_user_id: user.id, body: "Nice one")
    PostReaction.create!(post: demo_post, actor_type: "user", actor_id: user.id, kind: "applause")
    Follow.create!(follower_user_id: user.id, followable_type: "user", followable_id: demo_musician.id)
    UserBlock.create!(blocker: user, blocked: demo_musician)
    post = Post.create!(author_type: "user", author_id: user.id, created_by_user_id: user.id, kind: "update", body: "My own post")
    reshare = Post.create!(author_type: "user", author_id: user.id, created_by_user_id: user.id, kind: "update", body: "Sharing this", reshared_post_id: demo_post.id)
    Job.create!(employer: hirer, title: "Real listing", company: "Real Co", location: "Pune", kind: "Gig", genre: "Rock", description: "D" * 80, status: "published")
    request = UrgentRequest.create!(requester: hirer, title: "Real request", role_name: "Drummer", city: "Pune", currency: "INR", start_at: 2.days.from_now, status: "open")
    request.update_columns(status: "filled", filled_by_id: demo_musician.id)
    { user:, hirer:, post:, reshare:, request: }
  end

  def add_platform_rows(user_ids, real)
    musician = User.synthetic(BATCH).jobseeker.joins(:profile).where(profiles: { verified: true }).first
    hirer = User.synthetic(BATCH).employer.first
    booking = BookingRequest.where(requester_id: hirer.id).first || BookingRequest.first
    Badge.create!(user: musician, kind: "fast_responder_week", awarded_for: "2026-W39")
    ReviewPrompt.create!(source_type: "booking_request", source_id: booking.id, user: musician, counterpart: hirer, counterpart_name: hirer.name)
    Follow.create!(follower_user_id: musician.id, followable_type: "user", followable_id: real.fetch(:user).id)
    Follow.create!(follower_user_id: real.fetch(:user).id, followable_type: "act", followable_id: Act.where(owner_id: user_ids).first.id)
    Vouch.create!(voucher: musician, vouchee_email: "vouched@example.com", token: SecureRandom.hex(8), status: "invited")
    CareerEntry.create!(user: musician, kind: "credit", fields: { "title" => "Demo credit" })
    LifecycleEmail.record!(musician, "musician_day1_first_link")
    ProductEvent.create!(user_id: musician.id, anon_id: "anon-demo", name: "profile_view")
    Upload.create!(user_id: musician.id, storage: "disk", key: "demo/#{SecureRandom.hex(4)}", filename: "a.png", content_type: "image/png", byte_size: 10, status: "complete")
    Post.create!(author_type: "system", author_id: Post::SYSTEM_AUTHOR_ID, kind: "system", system_kind: "welcome", system_ref: "welcome:#{musician.id}",
      body: "Welcome #{musician.name.split.first}, drummer in Mumbai", visibility: "public", status: "active")
    Post.create!(author_type: "system", author_id: Post::SYSTEM_AUTHOR_ID, kind: "system", system_kind: "verified", system_ref: "verified:#{musician.id}",
      body: "#{musician.name} is now Verified", visibility: "public", status: "active")
    Post.create!(author_type: "system", author_id: Post::SYSTEM_AUTHOR_ID, kind: "system", system_kind: "fastest_responders", system_ref: "fastest_responders:Mumbai:2026-W39",
      body: "Fastest responders in Mumbai this week: #{musician.name}, Someone Else", visibility: "public", status: "active")
    filled = UrgentRequest.where(requester_id: hirer.id).first || UrgentRequest.where(status: "filled").first
    Post.create!(author_type: "system", author_id: Post::SYSTEM_AUTHOR_ID, kind: "system", system_kind: "urgent_filled", system_ref: "urgent_filled:#{filled.id}",
      body: "A Singer request in Mumbai was filled in 2 hours", visibility: "public", status: "active")
    Post.create!(author_type: "system", author_id: Post::SYSTEM_AUTHOR_ID, kind: "system", system_kind: "weekly_roundup", system_ref: "weekly_roundup:2026-09-28",
      body: "This week: who's looking, who's free.", visibility: "public", status: "active")
  end

  def assert_no_leftovers(user_ids)
    %w[posts post_comments post_reactions badges review_prompts follows vouches career_entries lifecycle_emails uploads talent_folders saved_jobs availability_windows portfolio_items
       messages conversations acts act_members booking_requests booking_quotes reviews organizations jobs applications application_events urgent_requests
       urgent_request_responses verification_requests].each do |table|
      # Rows that legitimately remain belong to the real people the test created.
      remaining = ActiveRecord::Base.lease_connection.select_value("SELECT COUNT(*) FROM #{table}").to_i
      expected = { "posts" => 3, "post_comments" => 0, "post_reactions" => 0, "follows" => 0, "jobs" => 1, "urgent_requests" => 1 }.fetch(table, 0)
      assert_equal expected, remaining, "#{table} kept rows from the purged batch"
    end
    assert_equal 0, Follow.where(follower_user_id: user_ids).or(Follow.where(followable_id: user_ids)).count
    assert_equal 0, ProductEvent.where(user_id: user_ids).count
    assert_equal 0, Portfolio.where(owner_id: user_ids).count
    assert_equal 0, ShowcaseSuggestion.where(owner_id: user_ids).count
  end
end
