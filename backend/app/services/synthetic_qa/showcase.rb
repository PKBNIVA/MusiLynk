module SyntheticQa
  # The "Verse showcase": 150 clearly badged demo accounts (110 musicians, 40 hirers) and the activity
  # around them, so a new marketplace looks and behaves like a live Mumbai one on day one. Everything is
  # written by hand in config/demo/*.yml (see ShowcaseContent); this class only places it.
  #
  # * Deterministic: content, names, cities, rates and relationships come from a fixed seed, so two
  #   runs produce the same batch (timestamps are relative to `now`).
  # * Idempotent: a batch that already exists is left alone (`skipped: true`).
  # * Safe in production: no ALLOW_SYNTHETIC_QA needed, but the batch name must start with "demo-", the
  #   whole demo population stays under Demo::MAX_USERS, no known password exists, e-mail addresses are
  #   example.invalid, and nothing is created that costs money or fills an admin queue: no
  #   subscriptions or payments, no reports, no pending verification requests, no pending reviews.
  # * Removable: Admin -> Demo data -> Delete (SyntheticQa::BatchCleanup).
  #
  # Photos are left empty on purpose; the app draws art for demo accounts.
  class Showcase
    BATCH = Demo::SHOWCASE_BATCH
    SEED = 20_260_930
    MUSICIANS = 110
    HIRERS = 40

    Result = Data.define(:batch, :jobseekers, :employers, :jobs, :applications, :conversations, :bookings, :acts,
      :urgent_requests, :reviews, :posts, :skipped)

    # How many of each role live in Mumbai (60 percent of the musicians). Every role the hire pages list
    # gets at least five, so /hire/<role>/mumbai has real profiles for all twelve.
    MUMBAI_PRIMARY = {
      "singer" => 6, "guitarist" => 6, "drummer" => 6, "music-producer" => 5, "keyboard-player" => 5, "bassist" => 5,
      "tabla-player" => 5, "sound-engineer" => 5, "dj" => 5, "dhol-player" => 5, "violinist" => 5, "saxophonist" => 5,
      "sitarist" => 1, "percussionist" => 1, "composer" => 1
    }.freeze
    # The other 44 musicians.
    OTHER_CITIES = {
      "Pune" => 9, "Navi Mumbai" => 4, "Thane" => 4, "Delhi" => 8, "Bengaluru" => 8, "Goa" => 4, "Kolkata" => 3,
      "Chennai" => 2, "Hyderabad" => 1, "Jaipur" => 1
    }.freeze
    VERIFIED_MUSICIANS = 33
    # Genres that point at a language or community, so a Bengali folk singer is not given a Tamil name.
    GENRE_REGIONS = {
      "Bengali" => %w[bengali], "Carnatic" => %w[tamil telugu kannada malayali], "Punjabi" => %w[punjabi sikh],
      "Bhangra" => %w[punjabi sikh], "Qawwali" => %w[muslim], "Ghazal" => %w[muslim punjabi gujarati],
      "Marathi" => %w[marathi]
    }.freeze
    GENRE_LANGUAGES = { "Bengali" => "Bengali", "Punjabi" => "Punjabi", "Qawwali" => "Urdu", "Ghazal" => "Urdu", "Sufi" => "Urdu" }.freeze
    # Which kind of track suits which genre or role (tracks.yml `families`).
    GENRE_FAMILIES = {
      "Hindustani" => %w[hindustani classical], "Classical" => %w[classical piano], "Western Classical" => %w[classical strings piano],
      "Carnatic" => %w[hindustani vocal], "Ghazal" => %w[vocal hindustani], "Sufi" => %w[vocal hindustani], "Qawwali" => %w[vocal hindustani],
      "Devotional" => %w[vocal hindustani], "Bhajan" => %w[vocal hindustani], "Jazz" => %w[jazz piano], "Blues" => %w[blues guitar],
      "Rock" => %w[rock guitar], "Metal" => %w[rock guitar], "Hip-Hop" => %w[hiphop], "Rap" => %w[hiphop], "EDM" => %w[electronic],
      "House" => %w[electronic], "Techno" => %w[electronic], "Electronic" => %w[electronic], "Lo-fi" => %w[electronic piano],
      "Ambient" => %w[electronic piano], "Folk" => %w[folk acoustic], "Acoustic" => %w[acoustic guitar], "Indie" => %w[acoustic pop],
      "Indie Pop" => %w[pop acoustic], "Pop" => %w[pop vocal], "Funk" => %w[funk], "Soul" => %w[vocal piano], "R&B" => %w[vocal pop],
      "Film Score" => %w[film piano], "Background Score" => %w[film piano], "Fusion" => %w[fusion percussion], "Bollywood" => %w[fusion vocal],
      "Punjabi" => %w[percussion folk], "Bhangra" => %w[percussion folk], "Jingle" => %w[pop], "World" => %w[percussion folk],
      "Orchestral" => %w[strings classical]
    }.freeze
    ROLE_FAMILIES = {
      "tabla-player" => %w[percussion hindustani], "sitarist" => %w[hindustani], "bansuri-player" => %w[hindustani folk],
      "dhol-player" => %w[percussion folk], "percussionist" => %w[percussion], "violinist" => %w[strings classical],
      "keyboard-player" => %w[piano], "guitarist" => %w[guitar], "singer" => %w[vocal], "dj" => %w[electronic hiphop],
      "saxophonist" => %w[jazz], "music-producer" => %w[electronic hiphop], "bassist" => %w[blues funk], "drummer" => %w[rock funk]
    }.freeze
    SAMPLE_COUNTS = [2, 1, 3, 2, 1, 2, 3, 1, 2, 2].freeze
    SAMPLE_LABELS = ["Studio playthrough", "Session reel", "Live set excerpt"].freeze
    AVAILABILITY_TEXT = ["Available this month", "Booking from next month", "Weekends open", "Weekday evenings open",
      "Available for the wedding season"].freeze
    SIGHT_READERS = %w[keyboard-player violinist saxophonist sitarist bansuri-player composer].freeze
    REMOTE_RECORDERS = %w[music-producer sound-engineer mastering-engineer composer violinist guitarist bassist].freeze
    COMPANY_SIZES = { "1-10" => "1-10", "11-50" => "11-50", "51-200" => "51-200" }.freeze
    ORG_TYPES = { "studio" => "studio", "wedding" => "planner", "agency" => "agency", "label" => "label", "college" => "college",
      "corporate" => "company", "venue" => "venue", "production" => "production" }.freeze
    # Application status history, oldest first (Application::STATUS_TRANSITIONS).
    STATUS_PATHS = {
      "Applied" => [], "Under Review" => ["Under Review"], "Shortlisted" => ["Under Review", "Shortlisted"],
      "Interview Scheduled" => ["Under Review", "Shortlisted", "Interview Scheduled"],
      "Offer" => ["Under Review", "Shortlisted", "Interview Scheduled", "Offer"],
      "Hired" => ["Under Review", "Shortlisted", "Interview Scheduled", "Offer", "Hired"],
      "Rejected" => ["Under Review", "Rejected"]
    }.freeze
    STATUS_MIX = (["Applied"] * 14 + ["Under Review"] * 12 + ["Shortlisted"] * 12 + ["Interview Scheduled"] * 6 + ["Offer"] * 4 +
      ["Hired"] * 4 + ["Rejected"] * 8).freeze
    APPLICATION_COUNT = 60
    CLOSED_JOB_TITLES = ["Tabla teacher for weekend batches", "Assistant to the live sound team, festival season",
      "Acoustic duo for Wednesday evenings"].freeze
    TEACHING_ROLES = %w[guitarist drummer keyboard-player tabla-player singer violinist sitarist].freeze
    ENGINEER_ROLES = %w[sound-engineer mastering-engineer].freeze
    PRODUCER_ROLES = %w[music-producer composer].freeze

    Person = Struct.new(:index, :role, :entry, :city, :region, :name, :user, :verified, :leader_of, keyword_init: true) do
      def first_name = name.split.first
      def label = ShowcaseContent.roles.fetch(role).fetch("label")
    end
    Hirer = Struct.new(:index, :company, :city, :region, :name, :user, :organization, keyword_init: true) do
      def first_name = name.split.first
      def category = company.fetch("category")
    end

    def self.call(...) = new(...).call

    def initialize(batch: BATCH, authorized_by: nil, now: Time.current, seed: SEED)
      @batch = batch.to_s
      @authorized_by = authorized_by
      @now = now.change(usec: 0)
      @rng = Random.new(seed)
      @counts = Hash.new(0)
    end

    def call
      guard!
      return result(skipped: true) if User.synthetic(batch).exists?

      # Before any account exists: a track that cannot be copied stops the seed instead of shipping samples that do not play.
      TrackMirror.mirror!(content.tracks)
      ApplicationRecord.transaction do
        build_people
        create_musicians
        create_hirers
        plan_acts
        verify_musicians
        create_acts
        create_jobs
        create_applications
        create_saved_jobs_and_folders
        create_urgent_requests
        create_bookings_and_reviews
        create_conversations
        create_posts
      end
      Rails.logger.info({ event: "demo_showcase.seeded", batch:, **@counts }.to_json)
      result(skipped: false)
    end

    private

    attr_reader :batch, :authorized_by, :now, :rng

    def content = ShowcaseContent
    def roles = content.roles

    def guard!
      raise ArgumentError, "The showcase batch must be named demo-<something> (lowercase letters, numbers, hyphens)." unless Demo.batch?(batch) && batch.match?(/\A[a-z0-9][a-z0-9-]{2,63}\z/)
      raise SecurityError, "Only an active admin can create demo data." if authorized_by && !(authorized_by.admin? && authorized_by.active?)
      return if User.synthetic(batch).exists?

      total = Demo.users.count + MUSICIANS + HIRERS
      raise ArgumentError, "Demo data is capped at #{Demo::MAX_USERS} users (this would make #{total}). Delete existing demo data first." if total > Demo::MAX_USERS
    end

    def result(skipped:)
      Result.new(batch:, jobseekers: @counts["jobseekers"], employers: @counts["employers"], jobs: @counts["jobs"],
        applications: @counts["applications"], conversations: @counts["conversations"], bookings: @counts["bookings"],
        acts: @counts["acts"], urgent_requests: @counts["urgent_requests"], reviews: @counts["reviews"], posts: @counts["posts"], skipped:)
    end

    def count!(key, amount = 1) = @counts[key] += amount

    def ago(days: 0, hours: 0, minutes: 0) = now - days.days - hours.hours - minutes.minutes

    # --- People: who, where, called what -------------------------------------------------------

    def build_people
      @people = []
      content.bios.each do |role, entries|
        entries.each { |entry| @people << Person.new(index: @people.size, role:, entry:) }
      end
      raise "Showcase bios must number #{MUSICIANS}, found #{@people.size}." unless @people.size == MUSICIANS

      assign_cities
      @hirers = content.companies.each_with_index.map { |company, index| Hirer.new(index:, company:, city: company.fetch("city")) }
      raise "Showcase companies must number #{HIRERS}, found #{@hirers.size}." unless @hirers.size == HIRERS

      assign_names
    end

    def assign_cities
      left = MUMBAI_PRIMARY.dup
      @people.each do |person|
        next unless left.fetch(person.role, 0).positive?

        person.city = "Mumbai"
        left[person.role] -= 1
      end
      # The rest, taken one role at a time so the same city does not get five drummers in a row.
      queues = @people.reject(&:city).group_by(&:role).values
      interleaved = []
      interleaved.concat(queues.filter_map(&:shift)) until queues.all?(&:empty?)
      cities = OTHER_CITIES.flat_map { |city, count| [city] * count }.shuffle(random: rng)
      raise "Showcase city plan does not add up." unless interleaved.size == cities.size

      interleaved.zip(cities) { |person, city| person.city = city }
    end

    def assign_names
      names = content.names
      firsts = names.fetch("regions").transform_values { _1.fetch("first").shuffle(random: rng) }
      lasts = names.fetch("regions").transform_values { _1.fetch("last").shuffle(random: rng) }
      rotation = Hash.new(0)
      used = Set.new
      (@people + @hirers).each do |subject|
        region = region_for(subject, names.fetch("city_regions"), rotation)
        first = firsts.fetch(region).shift || raise("Out of #{region} first names.")
        last = nil
        lasts.fetch(region).size.times do
          candidate = lasts.fetch(region)[rotation["last:#{region}"] % lasts.fetch(region).size]
          rotation["last:#{region}"] += 1
          next if used.include?("#{first} #{candidate}")

          last = candidate
          break
        end
        raise "No unused #{region} surname for #{first}." unless last

        subject.region = region
        subject.name = "#{first} #{last}"
        used << subject.name
      end
    end

    def region_for(subject, city_regions, rotation)
      if subject.is_a?(Person)
        hint = subject.entry.fetch("genres").filter_map { GENRE_REGIONS[_1] }.first
        if hint
          key = "hint:#{hint.first}"
          return hint[(rotation[key] += 1) % hint.size]
        end
      end
      options = city_regions.fetch(subject.city, city_regions.fetch("Mumbai"))
      options[(rotation["city:#{subject.city}"] += 1) % options.size]
    end

    def languages_for(person)
      base = content.names.fetch("region_languages").fetch(person.region) + ["English"]
      extras = person.entry.fetch("genres").filter_map { GENRE_LANGUAGES[_1] }
      (base + extras).uniq
    end

    # --- Musicians -----------------------------------------------------------------------------

    def password_digest = @password_digest ||= BCrypt::Password.create(SecureRandom.base58(40))

    def create_musicians
      @track_use = Hash.new(0)
      @people.each do |person|
        create_musician(person)
        count!("jobseekers")
      end
    end

    def create_musician(person)
      entry = person.entry
      spec = roles.fetch(person.role)
      created_at = ago(days: rng.rand(3..80), hours: rng.rand(0..23))
      user = User.create!(name: person.name, email: email_for("professional", person.index), password_digest:, role: "jobseeker",
        status: "active", email_verified: true, profile_complete: true, synthetic_batch: batch, created_at:, updated_at: created_at,
        last_login_at: ago(days: rng.rand(0..12), hours: rng.rand(0..23)))
      person.user = user
      rates = rates_for(person)
      attributes = {
        headline: "#{spec.fetch('label')} · #{entry.fetch('genres').first(2).join(' & ')} · #{entry.fetch('years')} years",
        location: person.city, bio: entry.fetch("text"), skills: skills_for(person), genres: entry.fetch("genres"),
        instruments: spec.fetch("instruments"), languages: languages_for(person), roles: roles_for(person),
        open_to: spec.fetch("open_to"), credits: entry.fetch("credits"), gear: spec.fetch("gear"), software: spec.fetch("software"),
        years_experience: entry.fetch("years"), experience: "#{entry.fetch('years')} years",
        availability: AVAILABILITY_TEXT[person.index % AVAILABILITY_TEXT.size], remote_recording: REMOTE_RECORDERS.include?(person.role),
        sight_reading: SIGHT_READERS.include?(person.role), travels_nationally: person.index % 5 < 2, passport_ready: person.index % 7 == 0,
        currency: "INR", email_notifications: false, created_at:, updated_at: created_at, **rates
      }
      attributes[:event_types] = event_types_for(person) if Profile.column_names.include?("event_types")
      user.create_profile!(attributes)
      create_samples(person)
      create_availability(person)
    end

    def skills_for(person)
      spec = roles.fetch(person.role)
      (spec.fetch("skills") + [spec.fetch("secondary")[person.index % spec.fetch("secondary").size]]).uniq
    end

    def roles_for(person)
      spec = roles.fetch(person.role)
      secondary = spec.fetch("secondary")
      picks = Array.new(person.role == "sound-engineer" ? 2 : 1) { |offset| secondary[(person.index + offset) % secondary.size] }
      [spec.fetch("label"), *picks].uniq
    end

    def event_types_for(person)
      options = %w[wedding sangeet corporate private-party concert festival club religious studio restaurant]
      options = %w[studio concert festival corporate] if %w[music-producer mastering-engineer composer sound-engineer].include?(person.role)
      options = %w[religious concert private-party cultural] if person.entry.fetch("genres").intersect?(%w[Devotional Bhajan Qawwali Sufi Ghazal])
      start = person.index % options.size
      Array.new(2 + person.index % 2) { |offset| options[(start + offset) % options.size] }.uniq
    end

    def rates_for(person)
      years = person.entry.fetch("years")
      tier = roles.fetch(person.role).fetch("tier").to_f
      session = round100((3000 + years * 480 * tier + rng.rand(-4..4) * 100).clamp(3000, 15_000))
      show = round100((session * 3.3).clamp(8000, 60_000))
      day = round100((session * 1.7).clamp(5000, 25_000))
      attributes = { session_rate: session, show_rate: show, day_rate: day }
      attributes[:tour_day_rate] = round100((day * 1.35).clamp(6000, 30_000)) if (person.index % 3).zero?
      attributes
    end

    def round100(value) = (value / 100.0).round * 100

    def create_availability(person)
      user = person.user
      near = now + rng.rand(4..20).days
      far = now + rng.rand(28..50).days
      user.availability_windows.create!(start_at: near.change(hour: 17), end_at: near.change(hour: 23), status: person.index % 5 == 0 ? "tentative" : "available",
        city: person.city, note: "Open for evening shows and sessions")
      user.availability_windows.create!(start_at: far.change(hour: 10), end_at: far.change(hour: 10) + 1.day, status: %w[booked hold unavailable][person.index % 3],
        city: person.city, note: "Travelling for a wedding weekend")
    end

    # --- Work samples: labelled CC BY tracks, never presented as the musician's own ---------------

    def create_samples(person)
      count = SAMPLE_COUNTS[person.index % SAMPLE_COUNTS.size]
      taken = []
      count.times do |position|
        track = pick_track(person, taken)
        taken << track.fetch("id")
        @track_use[track.fetch("id")] += 1
        item = person.user.portfolio_items.new(sample_attributes(person, track, position))
        # Tag the sample with everything the classifier would read out of its title and description, so
        # saving it does not queue a "suggested tags" inbox item for an account nobody signs in to.
        found = PortfolioItemClassifier.current.classify(item)
        item.tags |= found.tags
        item.roles |= found.roles
        item.genres |= found.genres
        item.instruments |= found.instruments
        # A copy in the app's own bucket is not "one of the user's uploads", which is what the model insists on for
        # bucket URLs; the seeder vouches for it.
        item.save!(validate: !TrackMirror.enabled?)
      end
    end

    def families_for(person)
      genre_families = person.entry.fetch("genres").flat_map { GENRE_FAMILIES.fetch(_1, []) }
      (genre_families + ROLE_FAMILIES.fetch(person.role, [])).tally
    end

    def pick_track(person, taken)
      wanted = families_for(person)
      content.tracks.reject { taken.include?(_1.fetch("id")) }
        .min_by { |track| [-track.fetch("families").sum { wanted.fetch(_1, 0) }, @track_use[track.fetch("id")], track.fetch("id")] }
    end

    def sample_attributes(person, track, position)
      artist = track.fetch("artist")
      title = track.fetch("title")
      short = title.length > 60 ? "#{title[0, 57].rstrip}..." : title
      spec = roles.fetch(person.role)
      genres = person.entry.fetch("genres")
      {
        kind: "audio", title: "#{SAMPLE_LABELS[(person.index + position) % SAMPLE_LABELS.size]} — demo sample: '#{short}' by #{artist} (#{track.fetch('license')})",
        url: TrackMirror.url_for(track), credited_as: "#{artist}, #{track.fetch('license')} (ccMixter)", visibility: "public", featured: position.zero?,
        sort_order: position, year: track.fetch("year"), tags: [*genres.map(&:downcase), "demo sample"], genres:, roles: [spec.fetch("label")],
        instruments: spec.fetch("instruments"),
        description: "Demo sample for illustration only. Audio: '#{title}' by #{artist}, licensed #{track.fetch('license')} (#{track.fetch('license_url')}) " \
          "and shared through ccMixter (#{track.fetch('source_url')}). Not performed by this account.",
        media_metadata: { "waveform" => track.fetch("peaks"), "durationSeconds" => track.fetch("duration_seconds"), "source" => "ccmixter",
                          "license" => track.fetch("license"), "licenseUrl" => track.fetch("license_url"), "sourceUrl" => track.fetch("source_url") }
      }
    end

    # --- Hirers ---------------------------------------------------------------------------------

    def create_hirers
      @hirers.each do |hirer|
        company = hirer.company
        created_at = ago(days: rng.rand(5..90), hours: rng.rand(0..23))
        user = User.create!(name: hirer.name, email: email_for("employer", hirer.index), password_digest:, role: "employer", status: "active",
          email_verified: true, profile_complete: true, synthetic_batch: batch, created_at:, updated_at: created_at,
          last_login_at: ago(days: rng.rand(0..20), hours: rng.rand(0..23)))
        hirer.user = user
        user.create_profile!(company_name: company.fetch("name"), company_size: COMPANY_SIZES.fetch(company.fetch("size")), location: hirer.city,
          headline: company.fetch("headline"), company_description: company.fetch("description"), email_notifications: false, created_at:, updated_at: created_at)
        organization = user.organizations.create!(name: company.fetch("name"), status: "active", org_type: ORG_TYPES.fetch(company.fetch("category")),
          city: hirer.city, billing_email: user.email, created_at:)
        organization.organization_members.create!(user:, role: "owner", created_at:)
        hirer.organization = organization
        count!("employers")
      end
    end

    def hirer_named(name) = @hirers.find { _1.company.fetch("name") == name } || raise("No demo hirer called #{name}.")

    def hirers_in(category) = @hirers.select { _1.category == category }

    # --- Acts and verification -------------------------------------------------------------------

    def plan_acts
      @act_plans = []
      used = Set.new
      content.acts.each do |act|
        leader = pick_person(act.fetch("leader"), used:, prefer_verified: act["pro"])
        used << leader.index
        leader.leader_of = act.fetch("name")
        members = act.fetch("members").map do |role|
          member = pick_person(role, used:, city: leader.city)
          used << member.index
          member
        end
        @act_plans << { act:, leader:, members: }
      end
    end

    # The next unused musician of a role, preferring one in `city` (Mumbai by construction for most roles).
    def pick_person(role, used:, city: nil, prefer_verified: false)
      pool = @people.select { _1.role == role && !used.include?(_1.index) }
      pool = pool.select { _1.city == "Mumbai" }.presence || pool if prefer_verified
      pool.find { city && _1.city == city } || pool.first || raise("No demo musician left for the role #{role}.")
    end

    def verify_musicians
      forced = @act_plans.select { _1.dig(:act, "pro") }.map { _1.fetch(:leader) }
      queues = @people.group_by(&:role).values.map(&:dup)
      interleaved = []
      interleaved.concat(queues.filter_map(&:shift)) until queues.all?(&:empty?)
      chosen = (forced + interleaved.reject { forced.include?(_1) }.each_slice(3).map(&:first)).uniq.first(VERIFIED_MUSICIANS)
      raise "The showcase verification plan is short." unless chosen.size == VERIFIED_MUSICIANS

      chosen.each do |person|
        person.verified = true
        approved_at = ago(days: rng.rand(2..40))
        person.user.verification_requests.create!(kind: "professional", status: "approved", note: "Demo profile — illustrative",
          checks: %w[identity work_links], reviewed_at: approved_at, created_at: approved_at - 1.day, updated_at: approved_at)
        person.user.profile.update_columns(verified: true)
      end
    end

    def create_acts
      @acts = @act_plans.map do |plan|
        spec = plan.fetch(:act)
        leader = plan.fetch(:leader)
        act = leader.user.owned_acts.create!(name: spec.fetch("name"), act_type: spec.fetch("act_type"), currency: "INR", fee_basis: "event", status: "active",
          tagline: spec.fetch("tagline"), bio: spec.fetch("bio"), city: leader.city, genres: spec.fetch("genres"), languages: languages_for(leader),
          event_types: spec.fetch("event_types"), lineup_size: spec.fetch("lineup_size"), min_fee: spec.fetch("min_fee"), max_fee: spec.fetch("max_fee"),
          travels_nationally: true, created_at: ago(days: rng.rand(10..70)))
        act.act_members.create!(user: leader.user, display_name: leader.name, role_name: leader.label, instrument: roles.fetch(leader.role).fetch("instruments").first,
          member_status: "confirmed", is_leader: true)
        plan.fetch(:members).each do |member|
          act.act_members.create!(user: member.user, display_name: member.name, role_name: member.label,
            instrument: roles.fetch(member.role).fetch("instruments").first, member_status: "confirmed")
        end
        count!("acts")
        act
      end
      @acts.zip(@act_plans) do |act, plan|
        leader = plan.fetch(:leader)
        extra = plan.dig(:act, "pro") ? ["Band leader", "Band manager"] : ["Band leader"]
        leader.user.profile.update_columns(roles: (leader.user.profile.roles + extra).uniq)
      end
    end

    # --- Opportunities and applications ------------------------------------------------------------

    def create_jobs
      @jobs = []
      cursor = Hash.new(0)
      content.jobs.each_with_index do |spec, index|
        pool = hirers_in(spec.fetch("category"))
        hirer = pool[cursor[spec.fetch("category")] % pool.size]
        cursor[spec.fetch("category")] += 1
        closed = CLOSED_JOB_TITLES.include?(spec.fetch("title"))
        published_at = ago(days: rng.rand(closed ? 25..40 : 1..18), hours: rng.rand(0..20))
        pay_min, pay_max = spec.fetch("pay")
        job = Job.create!(employer: hirer.user, title: spec.fetch("title"), company: hirer.company.fetch("name"), location: hirer.city, kind: spec.fetch("contract"),
          genre: spec.fetch("genre"), description: spec.fetch("description"), requirements: spec.fetch("requirements"), skills: spec.fetch("skills"),
          languages: %w[Hindi English], screening_questions: spec.fetch("questions"), status: closed ? "closed" : "published",
          opportunity_kind: spec.fetch("kind"), function_area: spec.fetch("function"), workplace: spec.fetch("workplace"), currency: "INR",
          compensation_min: pay_min, compensation_max: pay_max, compensation_period: spec.fetch("period"), slots: spec.fetch("slots"), paid: true,
          featured: (index % 9).zero?, portfolio_required: %w[Music producer Composer Sitarist].intersect?(spec.fetch("skills")),
          experience_level: spec.fetch("level"), application_deadline: closed ? ago(days: 3) : now + spec.fetch("deadline_in").days,
          start_date: now + spec.fetch("start_in").days, published_at:, created_at: published_at, updated_at: published_at)
        @jobs << { job:, spec:, hirer: }
        count!("jobs")
      end
    end

    def job_family(spec)
      skills = spec.fetch("skills")
      return :teaching if spec.fetch("function") == "Music Education"
      return :engineer if skills.intersect?(["Sound engineer", "FOH engineer", "Backline technician", "Monitor engineer", "Recording engineer", "Mix engineer", "Tour manager"])
      return :producer if skills.intersect?(["Music producer", "Composer"])
      return :dj if skills == ["DJ"]
      return :session if spec.fetch("kind") == "session"

      :performer
    end

    def candidates_for(spec)
      labels = spec.fetch("skills").map(&:downcase)
      matches = @people.select { |person| person.user.profile.roles.any? { labels.include?(_1.downcase) } }
      family = job_family(spec)
      matches = case family
      when :teaching then matches.select { TEACHING_ROLES.include?(_1.role) }.presence || @people.select { TEACHING_ROLES.include?(_1.role) }
      when :engineer then @people.select { ENGINEER_ROLES.include?(_1.role) }
      when :producer then matches.select { PRODUCER_ROLES.include?(_1.role) }.presence || @people.select { PRODUCER_ROLES.include?(_1.role) }
      else matches
      end
      matches.presence || @people.select { ENGINEER_ROLES.include?(_1.role) }
    end

    def create_applications
      notes = content.application_notes
      used_notes = Set.new
      applied = Hash.new(0)
      statuses = STATUS_MIX.shuffle(random: rng)
      @applications = []
      # Every listing gets one applicant, every third listing a second; if the pools ran short, keep cycling.
      second_round = @jobs.each_with_index.select { |_entry, index| (index % 3).zero? }.map(&:first)
      rounds = [@jobs, second_round, @jobs, @jobs, @jobs]
      rounds.each do |round|
        round.each do |entry|
          break if @applications.size >= APPLICATION_COUNT

          job = entry.fetch(:job)
          taken = @applications.select { _1.job_id == job.id }.map(&:candidate_id)
          candidate = candidates_for(entry.fetch(:spec)).reject { taken.include?(_1.user.id) }.min_by { [applied[_1.index], _1.index] }
          next unless candidate

          applied[candidate.index] += 1
          note = pick_note(notes, used_notes, job_family(entry.fetch(:spec)))
          status = job.closed? ? (taken.empty? ? "Hired" : "Rejected") : statuses.shift
          @applications << create_application(job, candidate, note, status)
          count!("applications")
        end
      end
      raise "Expected #{APPLICATION_COUNT} applications, built #{@applications.size}." unless @applications.size == APPLICATION_COUNT
    end

    def pick_note(notes, used, family)
      fit = family.to_s
      note = notes.find { !used.include?(_1.fetch("note")) && _1.fetch("fit") == fit } || notes.find { !used.include?(_1.fetch("note")) && _1.fetch("fit") == "any" } ||
             notes.find { !used.include?(_1.fetch("note")) } || raise("Out of cover notes.")
      used << note.fetch("note")
      note.fetch("note")
    end

    def create_application(job, candidate, note, status)
      applied_at = [job.published_at + rng.rand(4..90).hours, now - 3.hours].min
      application = job.applications.create!(candidate: candidate.user, status: "Applied", cover_letter: note.gsub("{company}", job.company).gsub("{job}", job.title),
        screening_answers: [], created_at: applied_at, updated_at: applied_at)
      application.application_events.create!(actor: candidate.user, event_type: "created", to_status: "Applied", note: "Application submitted", created_at: applied_at, updated_at: applied_at)
      from = "Applied"
      path = STATUS_PATHS.fetch(status)
      # Events are spread evenly between the application and its last change, so their order is unambiguous.
      last_change = [applied_at + path.size * rng.rand(6..40).hours, now - 30.minutes].min
      path.each_with_index do |to, step|
        moved_at = applied_at + (last_change - applied_at) * (step + 1) / path.size
        application.application_events.create!(actor: job.employer, event_type: "status_changed", from_status: from, to_status: to, note: "Status updated", created_at: moved_at, updated_at: moved_at)
        from = to
        application.update_columns(status: to, updated_at: moved_at)
        application.update_columns(interview_date: moved_at + 3.days) if to == "Interview Scheduled"
      end
      application.reload
    end

    def create_saved_jobs_and_folders
      @applications.each_with_index do |application, index|
        next unless index.even?

        SavedJob.create!(user_id: application.candidate_id, job_id: application.job_id, created_at: application.created_at)
      end
      @jobs.each_with_index do |entry, index|
        person = @people[(index * 7 + 3) % @people.size]
        next if SavedJob.exists?(user_id: person.user.id, job_id: entry.fetch(:job).id)

        SavedJob.create!(user_id: person.user.id, job_id: entry.fetch(:job).id, created_at: ago(days: rng.rand(0..10)))
      end
      folder_titles = { "wedding" => "Wedding singers and bands", "studio" => "Session players", "venue" => "Weekend residency shortlist", "agency" => "Festival crew",
                        "label" => "Producers to call", "corporate" => "Corporate event acts" }
      @hirers.each_with_index do |hirer, index|
        next unless (index % 3).zero?

        title = folder_titles.fetch(hirer.category, "Musicians to call")
        folder = hirer.user.talent_folders.create!(name: title, description: "Saved from the directory", created_at: ago(days: rng.rand(1..40)))
        @people.select { _1.city == "Mumbai" }.rotate(index * 5).first(4).each do |person|
          TalentFolderMember.create!(talent_folder_id: folder.id, candidate_id: person.user.id, note: "Good fit for #{hirer.category} events", created_at: folder.created_at)
        end
      end
      @hirers.each_with_index do |hirer, index|
        next unless index.odd?

        person = @people[(index * 11) % @people.size]
        TalentShortlist.create!(employer_id: hirer.user.id, candidate_id: person.user.id, note: "Shortlisted for an upcoming event", created_at: ago(days: rng.rand(0..30)))
      end
    end

    # --- Urgent requests -----------------------------------------------------------------------------

    def create_urgent_requests
      @urgent = []
      content.urgent_requests.each do |spec|
        hirer = hirer_named(spec.fetch("hirer"))
        filled = spec.fetch("status") == "filled"
        created_at = filled ? ago(days: spec.fetch("created_days_ago"), hours: rng.rand(0..8)) : ago(hours: spec.fetch("created_hours_ago"))
        start_at = filled ? ago(days: spec.fetch("start_days_ago")).change(hour: 18) : (now + spec.fetch("start_days_ahead").days).change(hour: 19)
        request = hirer.user.urgent_requests.create!(title: spec.fetch("title"), role_name: spec.fetch("role"), city: hirer.city, currency: "INR", status: "open",
          instrument: spec.fetch("instrument"), genre: spec.fetch("genre"), start_at:, end_at: start_at + spec.fetch("hours").hours, budget_min: spec.fetch("budget").first,
          budget_max: spec.fetch("budget").last, requirements: spec.fetch("requirements"), travel_covered: spec.fetch("travel_covered"), created_at:, updated_at: created_at,
          expires_at: filled ? created_at + 48.hours : start_at - 6.hours)
        responders = urgent_responders(spec, hirer.city)
        responses = spec.fetch("responses").first(responders.size).each_with_index.map do |message, position|
          responded_at = created_at + ([6, 15, 29, 47, 76][position] + rng.rand(0..4)).minutes
          budget = spec.fetch("budget")
          rate = round500(budget.first + (budget.last - budget.first) * (position + 1) / (spec.fetch("responses").size + 1))
          UrgentRequestResponse.create!(urgent_request: request, user: responders.fetch(position).user, message:, rate:, status: "available", created_at: responded_at, updated_at: responded_at)
          responders.fetch(position)
        end
        if filled
          winner = responses.fetch(spec.fetch("filled_by"))
          request.update_columns(status: "filled", filled_by_id: winner.user.id, updated_at: created_at + rng.rand(2..9).hours)
        end
        @urgent << { request: request.reload, spec:, hirer:, responders: responses }
        count!("urgent_requests")
      end
    end

    def round500(value) = (value / 500.0).round * 500

    # Musicians of the requested role, in the request's city where possible, in the order they replied.
    # The Verified Pro leaders answer (and win) the filled request of their role; open requests
    # rotate through the role's musicians so the same few do not answer everything.
    def urgent_responders(spec, city)
      role = spec.fetch("role")
      slug = roles.find { |_key, value| value.fetch("label") == role }&.first || raise("Unknown urgent role #{role}.")
      pool = @people.select { _1.role == slug }
      pool = pool.select { _1.city == city } + pool.reject { _1.city == city }
      size = spec.fetch("responses").size
      if (winner_index = spec["filled_by"])
        winner = @act_plans.find { _1.dig(:act, "pro") && _1.fetch(:leader).role == slug }&.fetch(:leader) || pool.first
        (pool - [winner]).first(size - 1).insert(winner_index, winner)
      else
        earlier = @urgent.count { _1.dig(:spec, "role") == role && _1.dig(:spec, "status") != "filled" }
        pool.rotate(earlier).first(size)
      end
    end

    # --- Bookings and their reviews --------------------------------------------------------------------

    def create_bookings_and_reviews
      pro_acts = @acts.zip(@act_plans).select { |_act, plan| plan.dig(:act, "pro") }.map(&:first)
      raise "The showcase needs five Verified Pro acts." unless pro_acts.size == 5

      booked = []
      content.booking_reviews.each do |spec|
        act = pro_acts.fetch(spec.fetch("pro_act"))
        hirer = (hirers_in(spec.fetch("hirer_category")) - booked).fetch(0)
        booked << hirer
        event_at = ago(days: rng.rand(8..50)).change(hour: 19)
        booking = act.booking_requests.create!(requester: hirer.user, event_type: spec.fetch("event_type"), city: hirer.city, currency: "INR", status: "completed",
          event_name: spec.fetch("event_name"), event_date: event_at, duration_minutes: spec.fetch("duration_minutes"), audience_size: spec.fetch("audience"),
          budget_min: spec.fetch("budget").first, budget_max: spec.fetch("budget").last, requirements: spec.fetch("requirements"),
          created_at: event_at - 30.days, updated_at: event_at + 1.day)
        booking.booking_quotes.create!(created_by: act.owner, performance_fee: spec.fetch("performance_fee"), travel_fee: spec.fetch("travel_fee"), production_fee: 0, other_fee: 0,
          currency: "INR", status: "accepted", inclusions: "Performance and sound check", exclusions: "Venue sound system",
          cancellation_terms: "Full refund of the advance up to 14 days before the event.", created_at: event_at - 25.days, updated_at: event_at - 20.days)
        create_review(hirer.user, act.owner, spec.fetch("hirer_review"), event_at + 2.days)
        create_review(act.owner, hirer.user, spec.fetch("musician_review"), event_at + 3.days) if spec["musician_review"]
        count!("bookings")
      end
    end

    def create_review(author, subject, review, at)
      Review.create!(author:, employer: subject, rating: review.fetch("rating"), title: review.fetch("title"), body: review.fetch("body"), status: "published",
        created_at: at, updated_at: at)
      count!("reviews")
    end

    # --- Conversations -----------------------------------------------------------------------------------

    def create_conversations
      threads = content.threads
      pairs = []
      seen = Set.new
      # Conversations grow out of applications that are moving, so start with those.
      moving = @applications.reject { %w[Applied Rejected].include?(_1.status) } + @applications.select { _1.status == "Applied" }
      threads.select { _1.fetch("topic") == "application" }.each_with_index do |thread, index|
        application = moving.fetch(index)
        seen << [application.job.employer_id, application.candidate_id, application.job_id]
        pairs << [thread, application.job.employer_id, application.candidate_id, application.job, application.created_at + 1.day]
      end
      enquirers = @hirers.select { %w[wedding venue college label studio corporate].include?(_1.category) }
      threads.select { _1.fetch("topic") == "enquiry" }.each_with_index do |thread, index|
        hirer = enquirers.fetch((index * 5) % enquirers.size)
        locals = @people.select { _1.city == hirer.city }.presence || @people
        person = locals.fetch((index * 3) % locals.size)
        person = locals.fetch((locals.index(person) + 1) % locals.size) if seen.include?([hirer.user.id, person.user.id, nil])
        seen << [hirer.user.id, person.user.id, nil]
        pairs << [thread, hirer.user.id, person.user.id, nil, ago(days: rng.rand(5..25))]
      end
      threads.select { _1.fetch("topic") == "urgent" }.each_with_index do |thread, index|
        entry = @urgent.fetch(index)
        responder = entry.fetch(:responders).find { !seen.include?([entry.fetch(:hirer).user.id, _1.user.id, nil]) }
        seen << [entry.fetch(:hirer).user.id, responder.user.id, nil]
        pairs << [thread, entry.fetch(:hirer).user.id, responder.user.id, nil, entry.fetch(:request).created_at + 2.hours]
      end
      pairs.each { |thread, employer_id, candidate_id, job, started_at| create_conversation(thread, employer_id, candidate_id, job, started_at) }
    end

    def create_conversation(thread, employer_id, candidate_id, job, started_at)
      employer = User.find(employer_id)
      candidate = User.find(candidate_id)
      conversation = Conversation.create!(candidate:, employer:, job:, created_at: started_at, updated_at: started_at)
      texts = { "{musician}" => candidate.name.split.first, "{hirer}" => employer.name.split.first, "{job}" => job&.title.to_s, "{company}" => employer.profile&.company_name.to_s }
      at = started_at
      messages = thread.fetch("messages")
      messages.each_with_index do |message, position|
        at = [at + rng.rand(12..600).minutes, now - 5.minutes].min
        body = texts.reduce(message.fetch("body")) { |text, (token, value)| text.gsub(token, value) }
        sender = message.fetch("from") == "hirer" ? employer : candidate
        read_at = position >= messages.size - 2 ? nil : at + 30.minutes
        Message.create!(conversation:, sender:, body:, read_at: read_at && [read_at, now].min, created_at: at, updated_at: at)
      end
      conversation.update_columns(updated_at: at)
      count!("conversations")
    end

    # --- Stage ---------------------------------------------------------------------------------------------

    def create_posts
      author_cursor = Hash.new(0)
      musicians_by_role = @people.group_by(&:role)
      actors = @people.map { _1.user.id } + @hirers.map { _1.user.id }
      content.posts.each_with_index do |spec, index|
        author, city = post_author(spec, musicians_by_role, author_cursor)
        posted_at = ago(days: spec.fetch("days_ago"), hours: rng.rand(0..9), minutes: rng.rand(0..59))
        attributes = { author_type: "user", author_id: author.id, created_by_user_id: author.id, kind: spec.fetch("kind"), body: spec.fetch("body"), city:,
                       genres: author.profile.genres.first(2), visibility: "public", status: "active", created_at: posted_at, updated_at: posted_at }
        if spec.fetch("kind") == "event"
          attributes.merge!(event_title: spec.fetch("event_title"), event_venue: spec.fetch("event_venue"), event_starts_at: (now + spec.fetch("event_in_days").days).change(hour: 19))
        end
        post = Post.create!(attributes)
        reactions = react_to(post, actors - [author.id], 3 + (index * 5 + 2) % 17, index)
        comments = comment_on(post, spec.fetch("comments", []), author, musicians_by_role, author_cursor)
        post.update_columns(applause_count: reactions, comment_count: comments)
        count!("posts")
      end
    end

    def post_author(spec, musicians_by_role, cursor)
      if spec.fetch("by") == "hirer"
        hirer = hirer_named(spec.fetch("hirer"))
        return [hirer.user, hirer.city]
      end
      list = musicians_by_role.fetch(spec.fetch("by"))
      person = list[cursor["post:#{spec.fetch('by')}"] % list.size]
      cursor["post:#{spec.fetch('by')}"] += 1
      [person.user, person.city]
    end

    def react_to(post, pool, wanted, index)
      actors = pool.rotate((index * 37) % pool.size).first(wanted)
      actors.each_with_index do |actor_id, position|
        at = post.created_at + (position + 1) * rng.rand(3..90).minutes
        PostReaction.create!(post:, actor_type: "user", actor_id:, kind: "applause", created_at: [at, now].min, updated_at: [at, now].min)
      end
      actors.size
    end

    def comment_on(post, comments, author, musicians_by_role, cursor)
      comments.each_with_index.count do |comment, position|
        list = musicians_by_role.fetch(comment.fetch("by")).reject { _1.user.id == author.id }
        next false if list.empty?

        person = list[cursor["comment:#{comment.fetch('by')}"] % list.size]
        cursor["comment:#{comment.fetch('by')}"] += 1
        at = [post.created_at + (position + 1) * rng.rand(1..6).hours + rng.rand(1..50).minutes, now - 1.minute].min
        PostComment.create!(post:, author_type: "user", author_id: person.user.id, created_by_user_id: person.user.id, body: comment.fetch("body"), status: "active",
          created_at: at, updated_at: at)
        true
      end
    end

    def email_for(kind, index) = "qa+#{batch}-#{kind}-#{format('%04d', index + 1)}@example.invalid"
  end
end
