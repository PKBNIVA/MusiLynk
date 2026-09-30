require "test_helper"

# The hand-written packs behind the demo showcase (config/demo/*.yml): shape, counts and the writing
# rules of the style card. No database.
class ShowcaseContentTest < ActiveSupport::TestCase
  content = SyntheticQa::ShowcaseContent
  BANNED_WORDS = /\b(passionate|best|amazing|world-class|incredible|legendary|renowned|leading|finest|greatest|unmatched|unparalleled|top-notch|award-winning|number one|expert)\b/i
  THIRD_PERSON = /\b(he|she|his|her|him|hers)\b/i

  test "names: twelve regions, over 300 first names, 120 surnames, none repeated" do
    regions = content.names.fetch("regions")
    assert_equal 12, regions.size
    firsts = regions.values.flat_map { _1.fetch("first") }
    lasts = regions.values.flat_map { _1.fetch("last") }
    assert_operator firsts.size, :>=, 300
    assert_equal firsts.size, firsts.uniq.size
    assert_equal 120, lasts.size
    assert_equal 120, lasts.uniq.size
    assert_equal regions.keys.sort, content.names.fetch("region_languages").keys.sort
    content.names.fetch("city_regions").each_value { |list| assert_empty list - regions.keys }
  end

  test "bios: 110 distinct first-person bios of two to four sentences, no superlatives, no third person" do
    bios = content.bios.values.flatten
    assert_equal 110, bios.size
    assert_equal 110, bios.map { _1.fetch("text") }.uniq.size
    assert_equal content.roles.keys.sort, content.bios.keys.sort
    genres = Search::Taxonomy.genres
    bios.each do |bio|
      text = bio.fetch("text")
      assert_no_match BANNED_WORDS, text
      assert_no_match THIRD_PERSON, text
      assert_operator text.scan(/[.!?](?:\s|\z)/).size, :>=, 2, text
      assert_operator text.scan(/[.!?](?:\s|\z)/).size, :<=, 4, text
      assert_operator text.length, :>=, 120, text
      assert_empty bio.fetch("genres") - genres, "genres outside the taxonomy in: #{text}"
      assert_equal 2, bio.fetch("credits").size
      assert_kind_of Integer, bio.fetch("years")
    end
  end

  test "role metadata uses the catalog instruments" do
    content.roles.each_value do |role|
      assert_empty role.fetch("instruments") - CatalogController::INSTRUMENTS
      assert_operator role.fetch("secondary").size, :>=, 2
    end
    Seo::Pages.roles.each_value do |label|
      assert_includes content.roles.values.map { _1.fetch("label") }, label, "every hire-page role has demo musicians"
    end
  end

  test "companies: 40 distinct hirers across the eight kinds, 60 percent in Mumbai" do
    companies = content.companies
    assert_equal 40, companies.size
    assert_equal 40, companies.map { _1.fetch("name") }.uniq.size
    assert_equal %w[agency college corporate label production studio venue wedding], companies.map { _1.fetch("category") }.uniq.sort
    assert_equal 24, companies.count { _1.fetch("city") == "Mumbai" }
    companies.each { |company| assert_operator company.fetch("description").length, :>=, 120 }
    assert_equal 40, companies.map { _1.fetch("description") }.uniq.size
  end

  test "jobs: 45 distinct opportunities in a hirer's voice" do
    jobs = content.jobs
    assert_equal 45, jobs.size
    assert_equal 45, jobs.map { _1.fetch("title") }.uniq.size
    assert_equal 45, jobs.map { _1.fetch("description") }.uniq.size
    assert_equal %w[audition collaboration gig internship job session tour], jobs.map { _1.fetch("kind") }.uniq.sort
    categories = content.companies.map { _1.fetch("category") }.uniq
    jobs.each do |job|
      assert_operator job.fetch("description").length, :>=, 60
      assert_includes categories, job.fetch("category")
      assert_includes Search::Taxonomy.function_areas, job.fetch("function")
      assert_includes Search::Taxonomy.genres, job.fetch("genre")
      assert_operator job.fetch("pay").first, :<=, job.fetch("pay").last
      assert_no_match BANNED_WORDS, job.fetch("description")
    end
  end

  test "urgent requests: 8, three filled and five open, each with replies" do
    requests = content.urgent_requests
    assert_equal 8, requests.size
    assert_equal({ "filled" => 3, "open" => 5 }, requests.map { _1.fetch("status") }.tally)
    companies = content.companies.map { _1.fetch("name") }
    requests.each do |request|
      assert_includes companies, request.fetch("hirer")
      assert_operator request.fetch("responses").size, :>=, 3
      assert_operator request.fetch("filled_by"), :<, request.fetch("responses").size if request.fetch("status") == "filled"
    end
    assert_equal 8, requests.map { _1.fetch("title") }.uniq.size
  end

  test "conversations: 25 threads of three to six distinct messages" do
    threads = content.threads
    assert_equal 25, threads.size
    assert_equal({ "application" => 15, "enquiry" => 6, "urgent" => 4 }, threads.map { _1.fetch("topic") }.tally)
    threads.each { |thread| assert_includes 3..6, thread.fetch("messages").size }
    bodies = threads.flat_map { |thread| thread.fetch("messages").map { _1.fetch("body") } }
    assert_equal bodies.size, bodies.uniq.size
  end

  test "stage posts: 40, spread over 30 days, real voices" do
    posts = content.posts
    assert_equal 40, posts.size
    assert_equal 40, posts.map { _1.fetch("body") }.uniq.size
    assert_equal [0, 29], posts.map { _1.fetch("days_ago") }.minmax
    companies = content.companies.map { _1.fetch("name") }
    posts.each do |post|
      assert_includes Post::KINDS, post.fetch("kind")
      assert_operator post.fetch("body").length, :<=, Post::BODY_LIMIT
      assert_no_match BANNED_WORDS, post.fetch("body")
      assert_includes companies, post.fetch("hirer") if post.fetch("by") == "hirer"
      assert_includes content.bios.keys, post.fetch("by") unless post.fetch("by") == "hirer"
      post.fetch("comments", []).each { |comment| assert_includes content.bios.keys, comment.fetch("by") }
    end
    assert_operator posts.count { _1.fetch("kind") == "gig" }, :>=, 3
    assert_operator posts.count { _1.fetch("body").include?("?") }, :>=, 3, "questions for the community"
  end

  test "reviews: six bookings, twelve distinct reviews rated 4 or 5" do
    bookings = content.booking_reviews
    assert_equal 6, bookings.size
    reviews = bookings.flat_map { [_1.fetch("hirer_review"), _1.fetch("musician_review")] }
    assert_equal 12, reviews.map { _1.fetch("body") }.uniq.size
    assert(reviews.all? { [4, 5].include?(_1.fetch("rating")) })
    bookings.each { assert_includes CatalogController::EVENT_TYPES, _1.fetch("event_type") }
  end

  test "acts and cover notes" do
    assert_equal 12, content.acts.size
    assert_equal 12, content.acts.map { _1.fetch("name") }.uniq.size
    assert_equal 3, content.acts.count { _1["pro"] }
    content.acts.each do |act|
      assert_includes CatalogController::ACT_TYPES, act.fetch("act_type")
      assert_includes content.bios.keys, act.fetch("leader")
      assert_empty act.fetch("members") - content.bios.keys
      assert_empty act.fetch("genres") - Search::Taxonomy.genres
    end
    assert_equal 60, content.application_notes.map { _1.fetch("note") }.uniq.size
  end

  test "tracks: 40 ccMixter CC BY tracks with 64 waveform peaks each, no audio committed" do
    tracks = content.tracks
    assert_equal 40, tracks.size
    assert_equal 40, tracks.map { _1.fetch("id") }.uniq.size
    tracks.each do |track|
      assert_match(/\ACC BY (2\.5|3\.0|4\.0)\z/, track.fetch("license"))
      assert_match(%r{\Ahttps://creativecommons\.org/licenses/by/\d\.\d/\z}, track.fetch("license_url"))
      assert_match(%r{\Ahttps://ccmixter\.org/content/.+\.mp3\z}, track.fetch("url"))
      assert_match(%r{\Ahttps://ccmixter\.org/files/}, track.fetch("source_url"))
      assert_equal 64, track.fetch("peaks").size
      assert(track.fetch("peaks").all? { |peak| peak.is_a?(Integer) && peak.between?(0, 100) })
      assert_equal 100, track.fetch("peaks").max
      assert_operator track.fetch("duration_seconds"), :>=, 60
    end
    assert_empty Dir[Rails.root.join("config/demo/**/*.{mp3,wav,ogg,flac}")]
  end
end
