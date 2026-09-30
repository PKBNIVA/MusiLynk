require "test_helper"
require "digest"
require "minitest/mock"
require "aws-sdk-s3"

# SyntheticQa::Showcase: the 150-account demo marketplace, checked against the brief and against what a
# visitor's browser would find through the public API.
class ShowcaseSeedTest < ActionDispatch::IntegrationTest
  BATCH = SyntheticQa::Demo::SHOWCASE_BATCH

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  test "seeds 110 musicians, 40 hirers and the activity around them, and does nothing the second time" do
    result = SyntheticQa::Showcase.call
    assert_equal false, result.skipped
    assert_equal({ jobseekers: 110, employers: 40, jobs: 45, applications: 60, conversations: 25, bookings: 12, acts: 12, urgent_requests: 8,
                   reviews: 18, posts: 40 }, result.to_h.slice(:jobseekers, :employers, :jobs, :applications, :conversations, :bookings, :acts, :urgent_requests, :reviews, :posts))

    assert_people
    assert_cities_languages_and_rates
    assert_verification
    assert_samples
    assert_hirers_and_nothing_that_costs_money
    assert_opportunities_and_applications
    assert_urgent_requests
    assert_conversations
    assert_acts_bookings_and_reviews
    assert_stage
    assert_public_api

    before = User.synthetic(BATCH).count
    again = SyntheticQa::Showcase.call
    assert again.skipped
    assert_equal before, User.synthetic(BATCH).count
  end

  test "with a bucket the samples play from the app's own copies of the tracks, not from ccMixter" do
    keys = %w[AWS_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION AWS_ENDPOINT_URL_S3 AWS_PUBLIC_BASE_URL]
    saved = keys.to_h { [_1, ENV.delete(_1)] }
    ENV.update("AWS_BUCKET" => "verse-test", "AWS_ACCESS_KEY_ID" => "id", "AWS_SECRET_ACCESS_KEY" => "secret", "AWS_REGION" => "auto",
      "AWS_ENDPOINT_URL_S3" => "https://acct.r2.cloudflarestorage.com", "AWS_PUBLIC_BASE_URL" => "https://media.verse.test")
    client = Aws::S3::Client.new(stub_responses: true, region: "auto")
    client.stub_responses(:head_object, "NotFound")
    copied = []
    client.stub_responses(:put_object, ->(context) { copied << context.params.fetch(:key) && {} })
    mp3 = "ID3\x04\x00\x00\x00\x00\x00\x00".b + ("\x00".b * 20_000)

    UploadStorage.stub(:client, client) do
      SyntheticQa::TrackMirror.stub(:download, ->(_url) { mp3 }) { SyntheticQa::Showcase.call }
    end

    assert_equal 40, copied.uniq.size, "every curated track is copied before the first account exists"
    items = PortfolioItem.where(user_id: User.synthetic(BATCH).select(:id))
    assert_operator items.count, :>=, 110
    assert(items.pluck(:url).all? { _1.match?(%r{\Ahttps://media\.verse\.test/demo/showcase/\d+\.mp3\z}) })
    assert(items.pluck(:url).none? { _1.include?("ccmixter.org") })
  ensure
    keys.each { |name| saved[name].nil? ? ENV.delete(name) : ENV[name] = saved[name] }
  end

  test "is deterministic: the same seed gives the same people, words and numbers" do
    SyntheticQa::Showcase.call
    first = fingerprint
    SyntheticQa::BatchCleanup.call(batch: BATCH)
    assert_equal 0, User.synthetic(BATCH).count

    SyntheticQa::Showcase.call(now: 3.days.from_now)
    assert_equal first, fingerprint
  end

  test "guard rails: demo names only, the user cap, admins only, no known password" do
    assert_raises(ArgumentError) { SyntheticQa::Showcase.call(batch: "qa-showcase") }
    assert_raises(ArgumentError) { SyntheticQa::Showcase.call(batch: "Demo Showcase") }
    jobseeker = User.create!(name: "Not Admin", email: "showcase-js@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    assert_raises(SecurityError) { SyntheticQa::Showcase.call(authorized_by: jobseeker) }

    SyntheticQa::BatchSeeder.call(batch: "demo-20260101-0000", jobseekers: 100, employers: 60)
    error = assert_raises(ArgumentError) { SyntheticQa::Showcase.call }
    assert_match(/capped at 300/, error.message)
    assert_equal 0, User.synthetic(BATCH).count
    assert_equal 160, SyntheticQa::Demo.users.count
  ensure
    SyntheticQa::BatchCleanup.call(batch: "demo-20260101-0000")
  end

  private

  def users = User.synthetic(BATCH)
  def musicians = users.jobseeker
  def hirers = users.employer

  def assert_people
    assert_equal 110, musicians.count
    assert_equal 40, hirers.count
    names = users.pluck(:name)
    assert_equal names.size, names.uniq.size, "no full name repeats inside the batch"
    assert(users.all? { _1.email.end_with?("@example.invalid") })
    assert(users.all?(&:email_verified))
    assert_equal 1, users.pluck(:password_digest).uniq.size, "one random password per batch"
    assert(users.none? { _1.authenticate("SyntheticPass123!") })
    assert_equal 0, users.where(profile_complete: false).count
    assert(Profile.where(user_id: users.select(:id)).all? { !_1.email_notifications })
    assert_equal 110, musicians.map { _1.profile.bio }.uniq.size, "110 distinct bios"
  end

  def assert_cities_languages_and_rates
    cities = Profile.where(user_id: musicians.select(:id)).group(:location).count
    assert_equal 66, cities.fetch("Mumbai")
    assert_equal %w[Bengaluru Chennai Delhi Goa Hyderabad Jaipur Kolkata Mumbai Navi\ Mumbai Pune Thane], cities.keys.sort
    languages = Profile.where(user_id: musicians.select(:id)).pluck(:languages).flatten.uniq
    %w[Hindi English Marathi Punjabi Bengali Tamil Telugu Kannada Malayalam Gujarati].each { assert_includes languages, _1 }
    genres = Profile.where(user_id: musicians.select(:id)).pluck(:genres).flatten.uniq
    assert_empty genres - Search::Taxonomy.genres
    Profile.where(user_id: musicians.select(:id)).each do |profile|
      assert_includes 3000..15_000, profile.session_rate
      assert_includes 8000..60_000, profile.show_rate
      assert_includes 5000..25_000, profile.day_rate
      assert_equal [0, 0, 0], [profile.session_rate % 100, profile.show_rate % 100, profile.day_rate % 100]
      assert_nil profile.website, "no placeholder websites"
    end
    Seo::Pages.roles.each do |slug, label|
      count = Seo::HireStats.counts_for(label, "Mumbai", include_demo: true).fetch(:professionals)
      assert_operator count, :>=, 5, "/hire/#{slug}/mumbai needs at least five demo profiles, found #{count}"
    end
    return unless Profile.column_names.include?("event_types")

    assert_equal 110, Profile.where(user_id: musicians.select(:id)).where("event_types::text <> '[]'").count
  end

  def assert_verification
    assert_equal 33, Profile.where(user_id: musicians.select(:id), verified: true).count
    approved = VerificationRequest.where(user_id: musicians.select(:id))
    assert_equal 33, approved.count
    assert_equal ["approved"], approved.distinct.pluck(:status)
    assert_equal ["Demo profile — illustrative"], approved.distinct.pluck(:note)
    assert_equal 0, VerificationRequest.where(status: "pending").count
    assert_equal 0, VerificationRequest.where(user_id: hirers.select(:id)).count
    pro = musicians.select { Verification::Tier.pro?(_1) }
    assert_equal 5, pro.size, "Verified Pro is computed from three completed jobs and a review: five acts' owners, 5 percent of 110"
    assert(pro.all? { _1.profile.verified? })
  end

  def assert_samples
    items = PortfolioItem.where(user_id: musicians.select(:id))
    assert_equal musicians.count, items.distinct.count(:user_id)
    assert_includes 1..3, items.group(:user_id).count.values.min
    assert_operator items.group(:user_id).count.values.max, :<=, 3
    tracks = SyntheticQa::ShowcaseContent.tracks.to_h { [_1.fetch("url"), _1] }
    items.each do |item|
      track = tracks.fetch(item.url)
      assert_equal "audio", item.kind
      assert_includes item.title, "demo sample"
      assert_includes item.title, track.fetch("license")
      assert_includes item.credited_as, track.fetch("license")
      assert_includes item.description, track.fetch("license_url")
      assert_equal track.fetch("peaks"), item.media_metadata.fetch("waveform")
      assert_no_match(/youtube|example\.com|verse\.example/, item.attributes.values.join(" "))
    end
    assert_operator items.distinct.count(:url), :>=, 35, "the forty tracks are spread across the musicians"
    assert_equal 0, ShowcaseSuggestion.count
  end

  def assert_hirers_and_nothing_that_costs_money
    profiles = Profile.where(user_id: hirers.select(:id))
    assert_equal 40, profiles.pluck(:company_name).uniq.size
    assert(profiles.all? { _1.company_description.to_s.length >= 120 })
    assert_equal 40, Organization.where(owner_id: hirers.select(:id)).count
    assert_equal 0, Subscription.count
    assert_equal 0, BookingPayment.count
    assert_equal 0, BillingEvent.count
    assert_equal 0, Report.count
    assert_equal 0, Review.where(status: "pending").count
    assert_equal 0, ReviewPrompt.count
    assert_equal 0, Notification.count
  end

  def assert_opportunities_and_applications
    jobs = Job.where(employer_id: hirers.select(:id))
    assert_equal 45, jobs.count
    assert_equal 45, jobs.distinct.count(:title)
    assert_equal({ "published" => 42, "closed" => 3 }, jobs.group(:status).count)
    assert_equal %w[audition collaboration gig internship job session tour], jobs.distinct.pluck(:opportunity_kind).sort
    assert(jobs.all? { _1.description.length >= 60 })
    assert(jobs.published.all? { _1.application_deadline > Time.current })
    applications = Application.where(job_id: jobs.select(:id))
    assert_equal 60, applications.count
    assert_equal 60, applications.distinct.count(:cover_letter)
    assert_operator applications.distinct.pluck(:status).size, :>=, 6
    assert_equal applications.count, applications.distinct.count("job_id || candidate_id")
    assert(applications.all? { musicians.exists?(_1.candidate_id) })
    assert(ApplicationEvent.where(application_id: applications.select(:id)).exists?(event_type: "created"))
    hired = applications.where(status: "Hired").first
    assert_equal ["Applied", "Under Review", "Shortlisted", "Interview Scheduled", "Offer"], hired.application_events.where(event_type: "status_changed").order(:created_at).pluck(:from_status)
    assert_operator SavedJob.where(job_id: jobs.select(:id)).count, :>=, 30
    assert_operator TalentFolder.where(owner_id: hirers.select(:id)).count, :>=, 10
    assert_operator TalentShortlist.where(employer_id: hirers.select(:id)).count, :>=, 15
    assert_equal 220, AvailabilityWindow.where(user_id: musicians.select(:id)).count
  end

  def assert_urgent_requests
    requests = UrgentRequest.where(requester_id: hirers.select(:id))
    assert_equal({ "filled" => 3, "open" => 5 }, requests.group(:status).count)
    requests.each do |request|
      assert_operator request.urgent_request_responses.count, :>=, 3
      assert_operator request.expires_at, :>, Time.current if request.open?
      assert request.filled_by_id.present? if request.status == "filled"
      assert_equal request.urgent_request_responses.count, request.urgent_request_responses.select(:user_id).distinct.count
    end
    assert requests.where(status: "filled").all? { _1.urgent_request_responses.exists?(user_id: _1.filled_by_id) }
    minutes = ProfileStats.batch(musicians.to_a).values.filter_map { _1["responseTimeMinutes"] }
    assert_operator minutes.size, :>=, 3, "some musicians answered three or more requests, so their reply time shows"
    assert(minutes.all? { _1.between?(5, 60) })
  end

  def assert_conversations
    conversations = Conversation.where(employer_id: hirers.select(:id))
    assert_equal 25, conversations.count
    sizes = conversations.map { _1.messages.count }
    assert(sizes.all? { (3..6).cover?(_1) }, sizes.inspect)
    bodies = Message.where(conversation_id: conversations.select(:id)).pluck(:body)
    assert_equal bodies.size, bodies.uniq.size, "messages are distinct"
    assert(bodies.none? { _1.match?(/\{(musician|hirer|job|company)\}/) }, "placeholders are filled in")
    assert_equal 15, conversations.where.not(job_id: nil).count
    assert(Message.where(conversation_id: conversations.select(:id)).all? { _1.created_at <= Time.current })
  end

  def assert_acts_bookings_and_reviews
    acts = Act.where(owner_id: musicians.select(:id))
    assert_equal 12, acts.count
    assert(acts.all? { _1.act_members.where(member_status: "confirmed").count.between?(2, 5) })
    assert(acts.all? { _1.act_members.where(is_leader: true).one? })
    assert_equal acts.count, acts.map(&:min_fee).uniq.size, "acts do not all start at the same fee"
    bookings = BookingRequest.where(requester_id: hirers.select(:id))
    assert_equal 12, bookings.count
    assert_equal ["completed"], bookings.distinct.pluck(:status)
    assert_equal 12, BookingQuote.where(booking_request_id: bookings.select(:id), status: "accepted").count
    reviews = Review.where(status: "published")
    assert_equal 18, reviews.count
    assert_equal 18, reviews.distinct.count(:body)
    assert_equal 12, reviews.where(author_id: hirers.select(:id)).count
    assert_equal 12, reviews.where(employer_id: musicians.select(:id)).count
  end

  def assert_stage
    posts = Post.where(created_by_user_id: users.select(:id))
    assert_equal 40, posts.count
    assert_equal 40, posts.distinct.count(:body)
    assert_operator posts.minimum(:created_at), :>=, 31.days.ago
    assert_operator posts.maximum(:created_at), :<=, Time.current
    assert_equal %w[event gig looking_for performance release update], posts.distinct.pluck(:kind).sort
    posts.each do |post|
      assert_equal post.post_reactions.count, post.applause_count
      assert_equal post.post_comments.count, post.comment_count
      assert_operator post.applause_count, :>=, 3
    end
    assert_operator PostComment.count, :>=, 45
    assert_equal 2, posts.where(kind: "event").count
    assert(posts.where(kind: "event").all? { _1.event_starts_at > Time.current })
    assert_equal 0, Post.where(author_type: "system").count
  end

  def assert_public_api
    get "/api/public/talent", params: { limit: 50 }
    assert_response :success
    talent = response.parsed_body.fetch("talent")
    assert_equal 50, talent.size
    assert(talent.all? { _1["demo"] == true })
    assert(talent.none? { _1.key?("email") || _1.key?("synthetic_batch") })

    Search::Taxonomy.talent_roles.each_key do |group|
      get "/api/public/talent", params: { role: group }
      assert_operator response.parsed_body.fetch("talent").size, :>=, 1, "the #{group} directory chip finds someone"
    end

    get "/api/public/hire-pages/drummer/mumbai"
    body = response.parsed_body
    assert_operator body.dig("counts", "professionals"), :>=, 5
    assert_equal false, body.fetch("indexable"), "demo profiles never make a hire page indexable"
    assert_operator body.fetch("featured").size, :>=, 5
    assert(body.fetch("featured").all? { _1["demo"] == true })

    get "/api/public/hire-pages/popular-searches"
    assert_operator response.parsed_body.fetch("items").size, :>=, 6

    get "/api/public/rates/mumbai"
    rates = response.parsed_body
    assert_equal false, rates.fetch("indexable")
    assert_operator rates.fetch("roles").count { _1["hasData"] }, :>=, 6
    singer = rates.fetch("roles").find { _1["slug"] == "singer" }
    assert singer["hasData"]
    assert_operator singer.dig("sessionRate", "median"), :>, 3000

    get "/api/public/stats"
    stats = response.parsed_body
    assert_equal [0, 0, 0, 0, 0], stats.values_at("verifiedProfiles", "professionals", "cities", "openOpportunities", "urgentRequests")
    assert_equal 110, stats.dig("listed", "professionals")
    assert_equal 33, stats.dig("listed", "verifiedProfiles")
    assert_operator stats.dig("listed", "openOpportunities"), :>=, 40
    assert_equal 5, stats.dig("listed", "urgentRequests")

    get "/api/jobs"
    assert(response.parsed_body.fetch("jobs").all? { _1["demo"] == true })
    get "/api/public/acts"
    assert_equal 12, response.parsed_body.fetch("acts").size
    get "/api/search", params: { q: "Singer" }
    assert(response.parsed_body.fetch("results").any? { _1["type"] == "talent" && _1["demo"] == true })
  end

  def fingerprint
    people = users.order(:email).map do |user|
      profile = user.profile
      [user.email, user.name, user.role, profile.location, profile.headline, profile.bio, profile.roles, profile.languages, profile.session_rate, profile.show_rate,
       profile.day_rate, profile.verified, profile.company_name, profile.company_description]
    end
    {
      people:,
      jobs: Job.where(employer_id: users.select(:id)).order(:title).pluck(:title, :location, :status, :compensation_min, :description),
      samples: PortfolioItem.where(user_id: users.select(:id)).pluck(:title, :url, :featured, :sort_order).sort_by(&:to_s),
      posts: Post.where(created_by_user_id: users.select(:id)).order(:body).pluck(:body, :kind, :city, :applause_count, :comment_count),
      acts: Act.where(owner_id: users.select(:id)).order(:name).pluck(:name, :city),
      applications: Application.joins(:job).order("jobs.title", :cover_letter).pluck("jobs.title", :cover_letter, :status),
      messages: Message.order(:body).pluck(:body),
      reviews: Review.order(:body).pluck(:body, :rating)
    }.transform_values { Digest::SHA256.hexdigest(_1.to_json) }
  end
end
