# Seeds a realistic data volume for query-plan work (docs/PERFORMANCE.md, "Query plans at volume").
#
#   RAILS_ENV=development DATABASE_URL=postgres://postgres@localhost:5433/ml_perf bin/rails db:create db:schema:load perf:seed
#
# Volume at SCALE=1 (the default): 50k users with profiles over 16 cities, 20k acts (60k lineup
# members), 20k message threads with 200k messages, 30k portfolio items, 5k urgent requests, 10k
# opportunities and 10k applications, plus 10k bookings, 100k notifications, 20k Stage posts and 10k
# availability windows. SCALE=0.01 seeds a hundredth (the test uses that).
#
# Idempotent: every row has a deterministic id ("<prefix>_perf_<n>") and is written with insert_all,
# which skips rows that already exist, so a second run adds nothing. Development and test only: it
# refuses to run in production (or against a DATABASE_URL that does not look local).
#
# Two probe accounts get a heavy share of the activity (300 threads, 500 notifications, 50 acts each
# side) so the inbox, thread, bookings and notification queries are measured for a busy user. Their
# bearer tokens are fixed (PerfSeed::PROBE_TOKENS) so `perf:explain` can call the API as them; that is
# only safe because this data never exists outside a local scratch database.
# Defined once even when the tasks are loaded again (several tests call load_tasks).
unless defined?(PerfSeed)
  module PerfSeed
    CITIES = [
      ["Mumbai", "Maharashtra"], ["Delhi", "Delhi"], ["Bengaluru", "Karnataka"], ["Chennai", "Tamil Nadu"],
      ["Kolkata", "West Bengal"], ["Hyderabad", "Telangana"], ["Pune", "Maharashtra"], ["Ahmedabad", "Gujarat"],
      ["Jaipur", "Rajasthan"], ["Goa", "Goa"], ["Kochi", "Kerala"], ["Lucknow", "Uttar Pradesh"],
      ["Chandigarh", "Punjab"], ["Indore", "Madhya Pradesh"], ["Guwahati", "Assam"], ["Shillong", "Meghalaya"]
    ].freeze
    ROLES = ["Vocalist", "Guitarist", "Drummer", "Keyboardist", "Bassist", "Tabla Player", "Sound Engineer", "Music Producer",
      "DJ", "Violinist", "Flautist", "Composer", "Mixing Engineer", "Saxophonist", "Sitar Player", "Music Teacher"].freeze
    INSTRUMENTS = ["Guitar", "Drums", "Piano", "Bass", "Tabla", "Violin", "Flute", "Saxophone", "Sitar", "Harmonium", "Cajon", "Dholak"].freeze
    GENRES = ["Bollywood", "Indie", "Rock", "Classical", "Sufi", "Jazz", "EDM", "Folk", "Hip Hop", "Carnatic", "Hindustani", "Pop"].freeze
    LANGUAGES = ["Hindi", "English", "Marathi", "Tamil", "Telugu", "Bengali", "Punjabi", "Kannada", "Malayalam", "Gujarati"].freeze
    EVENT_TYPES = ["wedding", "corporate", "club", "concert", "private party", "festival"].freeze
    SKILLS = ["Mixing", "Mastering", "Live sound", "Session recording", "Sight reading", "Arranging", "Improvisation", "Ableton", "Pro Tools", "Teaching"].freeze
    ACT_TYPES = %w[band duo trio solo orchestra dj].freeze
    PROBE_TOKENS = { jobseeker: "perf-probe-jobseeker-token", employer: "perf-probe-employer-token" }.freeze
    BATCH = 2_000

    module_function

    def guard!
      abort "perf:seed refuses to run in production." if Rails.env.production?
      abort "perf:seed runs in development or test only." unless Rails.env.development? || Rails.env.test?
      url = ENV["DATABASE_URL"].to_s
      abort "perf:seed refuses a non-local DATABASE_URL." if url.present? && !url.match?(%r{@(localhost|127\.0\.0\.1|\[::1\])[:/]})
    end

    def counts(scale)
      base = { users: 50_000, acts: 20_000, conversations: 20_000, messages_per_thread: 10, portfolio_items: 30_000, urgent_requests: 5_000,
        jobs: 10_000, applications: 10_000, bookings: 10_000, notifications: 100_000, posts: 20_000, availability: 10_000 }
      base.to_h { |key, value| [key, key == :messages_per_thread ? value : [(value * scale).round, 8].max] }
    end

    def id(prefix, n) = format("%s_perf_%07d", prefix, n)

    def call(scale: 1.0, out: $stdout)
      guard!
      n = counts(scale)
      rng = Random.new(42)
      now = Time.current.change(usec: 0)
      users = n[:users]
      employers = (users * 0.16).round
      seekers = users - employers
      js = ->(i) { id("user", i % seekers) }
      emp = ->(i) { id("user", seekers + (i % employers)) }
      probe_js = js.(0)
      probe_emp = emp.(0)
      digest = BCrypt::Password.create("PerfSeedPassword123!", cost: BCrypt::Engine::MIN_COST)
      pick = ->(list, k) { list.sample(k, random: rng) }
      stamp = ->(days) { now - rng.rand(days * 86_400) }

      write(User, users, out) do |i|
        seeker = i < seekers
        created = stamp.(400)
        { id: id("user", i), name: seeker ? "Perf Artist #{i}" : "Perf Hirer #{i}", email: "perf-#{i}@perf.musilynk.test", role: seeker ? "jobseeker" : "employer",
          password_digest: digest, status: rng.rand < 0.97 || i.zero? || i == seekers ? "active" : "suspended", profile_complete: !seeker || i.zero? || rng.rand < 0.9,
          email_verified: true, last_login_at: rng.rand < 0.1 ? nil : stamp.(180), created_at: created, updated_at: created }
      end

      write(Profile, users, out) do |i|
        seeker = i < seekers
        city, state = CITIES[i % CITIES.size]
        role = ROLES[rng.rand(ROLES.size)]
        genres = pick.(GENRES, 1 + rng.rand(3))
        row = { user_id: id("user", i), location: "#{city}, #{state}", verified: rng.rand < 0.1, created_at: now, updated_at: now }
        next row.merge(company_name: "Perf Studio #{i}", headline: "Hiring musicians in #{city}") unless seeker
        row.merge(
          headline: "#{role} · #{genres.first}", bio: "#{role} based in #{city} playing #{genres.join(', ')} for #{EVENT_TYPES.sample(random: rng)}s. " * 2,
          roles: [role], skills: pick.(SKILLS, 1 + rng.rand(3)), genres:, instruments: pick.(INSTRUMENTS, rng.rand(3)),
          languages: pick.(LANGUAGES, 1 + rng.rand(3)), event_types: pick.(EVENT_TYPES, rng.rand(3)), open_to: rng.rand < 0.3 ? ["weddings"] : [],
          years_experience: rng.rand(25), show_rate: rng.rand < 0.6 ? 5_000 + rng.rand(95_000) : nil, session_rate: rng.rand < 0.3 ? 2_000 + rng.rand(20_000) : nil,
          remote_recording: rng.rand < 0.2
        )
      end

      write(Session, 2, out) do |i|
        { id: id("sess", i), user_id: i.zero? ? probe_js : probe_emp, token_digest: Digest::SHA256.hexdigest(PROBE_TOKENS.values[i]),
          expires_at: now + 10.years, absolute_expires_at: now + 10.years, last_seen_at: now, created_at: now, updated_at: now }
      end

      jobs = n[:jobs]
      write(Job, jobs, out) do |i|
        city, = CITIES[rng.rand(CITIES.size)]
        published = rng.rand < 0.7
        created = stamp.(120)
        { id: id("job", i), employer_id: emp.(rng.rand(employers)), title: "#{ROLES[i % ROLES.size]} for #{EVENT_TYPES[i % EVENT_TYPES.size]} in #{city}",
          company: "Perf Studio #{i}", location: city, kind: "Gig", genre: GENRES[i % GENRES.size], skills: pick.(SKILLS, 2),
          description: "We need an experienced #{ROLES[i % ROLES.size].downcase} for a #{EVENT_TYPES[i % EVENT_TYPES.size]} with a #{GENRES[i % GENRES.size]} set list. Rehearsal the day before.",
          status: published ? "published" : %w[draft pending closed].sample(random: rng), opportunity_kind: "gig", workplace: "on_site",
          published_at: published ? created : nil, application_deadline: rng.rand < 0.5 ? now + rng.rand(60).days : nil, created_at: created, updated_at: created }
      end

      write(Application, n[:applications], out) do |i|
        { id: id("appl", i), job_id: id("job", (i * 37) % jobs), candidate_id: i < 200 ? js.(0) : js.(i), status: "Applied", created_at: stamp.(60), updated_at: now }
      end

      acts = n[:acts]
      write(Act, acts, out) do |i|
        city, = CITIES[i % CITIES.size]
        { id: id("act", i), owner_id: i < 50 ? probe_js : js.(i * 3), name: "Perf #{GENRES[i % GENRES.size]} #{ACT_TYPES[i % ACT_TYPES.size]} #{i}",
          act_type: ACT_TYPES[i % ACT_TYPES.size], currency: "INR", fee_basis: "event", status: rng.rand < 0.9 ? "active" : "inactive",
          tagline: "#{GENRES[i % GENRES.size]} for #{EVENT_TYPES[i % EVENT_TYPES.size]}s", city:, genres: pick.(GENRES, 2), event_types: pick.(EVENT_TYPES, 2),
          lineup_size: 3, verified: rng.rand < 0.1, created_at: stamp.(300), updated_at: stamp.(60) }
      end
      write(ActMember, acts * 3, out) do |i|
        act = i / 3
        leader = (i % 3).zero?
        { id: id("actm", i), act_id: id("act", act), user_id: leader ? (act < 50 ? probe_js : js.(act * 3)) : nil, display_name: "Member #{i}",
          role_name: ROLES[i % ROLES.size], instrument: INSTRUMENTS[i % INSTRUMENTS.size], member_status: "confirmed", is_leader: leader, created_at: now, updated_at: now }
      end

      write(BookingRequest, n[:bookings], out) do |i|
        { id: id("book", i), act_id: id("act", i < 100 ? i % 50 : i % acts), requester_id: i.between?(100, 299) ? probe_emp : emp.(i), event_type: EVENT_TYPES[i % EVENT_TYPES.size],
          city: CITIES[i % CITIES.size].first, currency: "INR", status: BookingRequest::STATUSES[i % BookingRequest::STATUSES.size],
          event_date: now + rng.rand(90).days, created_at: stamp.(90), updated_at: stamp.(30) }
      end

      conversations = n[:conversations]
      probe_threads = [300, conversations / 4].min
      write(Conversation, conversations, out) do |i|
        candidate, employer = if i < probe_threads then [probe_js, emp.(i)]
        elsif i < probe_threads * 2 then [js.(i), probe_emp]
        else [js.(i), emp.(i * 7)]
        end
        { id: id("conv", i), candidate_id: candidate, employer_id: employer, created_at: stamp.(200), updated_at: stamp.(30) }
      end
      per = n[:messages_per_thread]
      write(Message, conversations * per, out) do |i|
        conv = i / per
        position = i % per
        candidate = conv < probe_threads ? probe_js : js.(conv)
        employer = conv < probe_threads ? emp.(conv) : (conv < probe_threads * 2 ? probe_emp : emp.(conv * 7))
        at = now - (conversations - conv).minutes - (per - position).hours
        unread = position >= per - 2 && conv % 3 == 0
        { id: id("msg", i), conversation_id: id("conv", conv), sender_id: position.even? ? employer : candidate,
          body: "Message #{position} about the #{EVENT_TYPES[conv % EVENT_TYPES.size]} on the #{1 + (conv % 28)}th.", read_at: unread ? nil : at + 5.minutes,
          created_at: at, updated_at: at }
      end

      write(PortfolioItem, n[:portfolio_items], out) do |i|
        kind = %w[audio video image audio].fetch(i % 4)
        { id: id("port", i), user_id: js.(i * 11), kind:, title: "#{GENRES[i % GENRES.size]} #{kind} sample #{i}", url: "https://media.perf.musilynk.test/#{i}.#{kind == 'image' ? 'jpg' : 'mp3'}",
          visibility: rng.rand < 0.85 ? "public" : "private", tags: pick.(SKILLS, 2), genres: pick.(GENRES, 2), roles: [ROLES[i % ROLES.size]],
          description: "A #{kind} sample of #{GENRES[i % GENRES.size]} work.", featured: rng.rand < 0.1, created_at: stamp.(300), updated_at: stamp.(100) }
      end

      write(UrgentRequest, n[:urgent_requests], out) do |i|
        open = i % 3 == 0
        start = open ? now + (1 + rng.rand(72)).hours : now - rng.rand(90).days
        { id: id("urg", i), requester_id: emp.(i), title: "Need a #{ROLES[i % ROLES.size].downcase} tomorrow", role_name: ROLES[i % ROLES.size],
          instrument: INSTRUMENTS[i % INSTRUMENTS.size], city: CITIES[i % CITIES.size].first, currency: "INR", status: open ? "open" : %w[filled cancelled expired].fetch(i % 3),
          start_at: start, expires_at: start, created_at: start - 1.day, updated_at: start - 1.day }
      end

      write(Notification, n[:notifications], out) do |i|
        user = i < 500 ? probe_js : (i < 1000 ? probe_emp : id("user", rng.rand(users)))
        at = stamp.(90)
        { id: id("noti", i), user_id: user, kind: "system", title: "Perf notification #{i}", body: "Something happened.", read_at: rng.rand < 0.7 ? at : nil, created_at: at, updated_at: at }
      end

      write(Post, n[:posts], out) do |i|
        author = js.(i * 5)
        at = stamp.(30)
        { id: id("post", i), author_type: "user", author_id: author, created_by_user_id: author, kind: "update", body: "Perf post #{i} from rehearsal.",
          city: CITIES[i % CITIES.size].first, genres: pick.(GENRES, 2), hashtags: [GENRES[i % GENRES.size].downcase.delete(" ")], visibility: "public", status: "active",
          applause_count: rng.rand(20), comment_count: rng.rand(5), created_at: at, updated_at: at }
      end

      write(AvailabilityWindow, n[:availability], out) do |i|
        start = now + rng.rand(60).days
        { id: id("avail", i), user_id: js.(i * 4), start_at: start, end_at: start + 1.day, status: %w[available unavailable booked].fetch(i % 3), created_at: now, updated_at: now }
      end

      %w[users profiles messages conversations portfolio_items acts act_members jobs applications notifications posts booking_requests urgent_requests].each do |table|
        ActiveRecord::Base.connection.execute("ANALYZE #{table}")
      end
      n
    end

    # insert_all in batches of BATCH; existing ids are skipped (ON CONFLICT DO NOTHING).
    def write(model, count, out)
      inserted = 0
      (0...count).each_slice(BATCH) do |slice|
        rows = slice.map { yield _1 }
        # insert_all needs one key set per call (employer and musician profiles differ).
        rows.group_by(&:keys).each_value { inserted += model.insert_all(_1, record_timestamps: false).length }
      end
      out.puts "perf:seed #{model.table_name}: #{inserted} new of #{count}"
    end
  end
end

namespace :perf do
  desc "Seed a realistic volume of users, acts, threads, samples and listings into a local scratch database (SCALE=1, dev/test only)."
  task seed: :environment do
    PerfSeed.call(scale: Float(ENV.fetch("SCALE", "1")))
  end
end
