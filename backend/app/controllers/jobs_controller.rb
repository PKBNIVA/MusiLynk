class JobsController < ApplicationController
  include JobAuthoring
  include ListPaging
  include ActingAs
  FILTER_PARAMS = %i[q roles location kind function workplace experience paid verified limit cursor].freeze
  LIST_LIMIT = 200
  # The public listing is paged with a keyset cursor: `?limit=` (default PAGE_SIZE, at most
  # MAX_PAGE_SIZE; anything else falls back to the default) and `?cursor=` from the previous
  # page's `nextCursor`.
  PAGE_SIZE = 30
  MAX_PAGE_SIZE = 100
  LIST_ORDER = ["jobs.featured DESC", "jobs.created_at DESC", "jobs.id DESC"].freeze
  # Newest-first browsing (no search query): V-16. Kept apart from LIST_ORDER, which still breaks
  # ties for search relevance ranking.
  BROWSE_ORDER = ["jobs.published_at DESC NULLS LAST", "jobs.id DESC"].freeze
  # NULL-safe sentinel so the keyset comparison below matches "NULLS LAST" for a job that
  # (defensively) has no published_at; a published job is given one when it is approved, so this
  # only guards against that invariant ever slipping.
  BROWSE_SENTINEL = "-infinity"
  # `?roles=Drummer,Vocalist` finds opportunities for any of those roles (a musician's own roles).
  MAX_ROLES = 6

  def index
    # ?location[]=a or ?kind[x]=y arrive as arrays/hashes; the filters below expect text.
    if (bad = FILTER_PARAMS.find { params.key?(_1) && !params[_1].is_a?(String) })
      return render_error("Search filter \"#{bad}\" must be a single text value.", :bad_request, "INVALID_FILTER")
    end
    limit = page_size
    # Each branch below sets its own order (BROWSE_ORDER for browsing, LIST_ORDER as the
    # relevance tiebreak for search), so this relation starts unordered.
    jobs = Job.published.from_active_hirers.with_applications_count.with_posted_as.includes(employer: :profile)
    # Same rule as talent: non-demo synthetic QA batches are only listed to synthetic viewers.
    jobs = SyntheticQa::Demo.publicly_listed(jobs.joins(:employer)) unless current_user&.synthetic_batch.present?
    jobs = Search::Query.new(params[:location]).as_location.filter(jobs, Search::Targets::JOBS)
    jobs = jobs.where(function_area: Search::Taxonomy.function_spellings(params[:function])) if params[:function].present?
    { kind: :opportunity_kind, workplace: :workplace, experience: :experience_level }.each { |key, column| jobs = jobs.where(column => params[key]) if params[key].present? }
    jobs = jobs.where(paid: true) if params[:paid] == "true"
    jobs = jobs.joins(employer: :profile).where(profiles: { verified: true }) if params[:verified] == "true"

    query = search_query
    if query.blank? && !query.inert?
      # Browsing: newest first, keyset cursor over (published_at, id) (V-16).
      jobs = jobs.reorder(*BROWSE_ORDER.map { Arel.sql(_1) })
      after = decode_cursor(params[:cursor])
      return render_error("This list position is no longer valid. Start the search again.", :bad_request, "INVALID_CURSOR") if after == false
      total = jobs.except(:select, :order, :includes).count
      if after
        jobs = jobs.where(
          "(COALESCE(jobs.published_at, timestamp '#{BROWSE_SENTINEL}'), jobs.id) < (COALESCE(?, timestamp '#{BROWSE_SENTINEL}'), ?)",
          *after,
        )
      end
      page = jobs.limit(limit + 1).to_a
      more = page.length > limit
      page = page.first(limit)
      next_cursor = more ? encode_cursor(page.last) : nil
      meta = {}
    else
      # Searching: ranked by relevance, so the cursor is a position in the ranking.
      offset = list_offset
      return render_invalid_cursor if offset.nil?
      search = Search::Runner.call(jobs, query, Search::Targets::JOBS, order: LIST_ORDER, offset:, limit:)
      page = search.rows
      next_cursor = list_next_cursor(search, offset, limit)
      total = search.total
      meta = search.meta
    end
    saved = current_user&.jobseeker? ? SavedJob.where(user: current_user, job_id: page.map(&:id)).pluck(:job_id).to_set : Set.new
    render json: {
      jobs: page.map { |job| job.api_json(current_user).merge(saved: saved.include?(job.id)) },
      nextCursor: next_cursor,
      total:
    }.merge(meta)
  end

  def show
    job = Job.with_applications_count.with_posted_as.includes(employer: :profile).find(params[:id])
    hidden_synthetic = job.employer.synthetic_batch.present? && !job.employer.synthetic_batch.start_with?(SyntheticQa::Demo::PREFIX) && current_user&.synthetic_batch.blank?
    # A closed listing (deadline passed, JobsDeadlineSweepJob) stays reachable at its own URL
    # rather than 404ing — the client shows a "This listing has closed" banner and hides Apply.
    # A listing whose poster erased their account is no longer readable (admins still see it).
    gone = job.employer.deleted? && !current_user&.admin?
    unless (((job.published? || job.closed?) && !hidden_synthetic) && !gone) || current_user&.admin? || (current_user&.id == job.employer_id && !gone)
      return render_error("Opportunity not found", :not_found)
    end
    applied = current_user&.jobseeker? && Application.exists?(candidate: current_user, job:)
    saved = current_user&.jobseeker? && SavedJob.exists?(user: current_user, job:)
    render json: { job: job.api_json(current_user).merge(applied:, saved:) }
  end

  # The poster's plan capacity for active opportunities, read by the post-opportunity page so it
  # can say so before the first field is filled (J-01) instead of after the last step.
  def limits
    return unless authenticate!("jobseeker", "employer")
    entitlements = Entitlements.for(current_user)
    render json: {
      activeAllowed: entitlements.limit(:active_posts),
      activeUsed: current_user.jobs.where(status: ACTIVE_STATUSES).count,
      plan: entitlements.plan_code,
      planName: entitlements.plan.fetch(:name)
    }
  end

  def create
    return unless authenticate!("jobseeker", "employer")
    return unless require_scalar_params!(:status, :company)
    return unless (actor = current_actor)
    draft = params[:status] == "draft"
    attributes = job_params(defaults: true)
    flags = moderation_flags_for(attributes)
    # Posted as a Page: the listing carries the Page's name unless the client gave a company.
    company = params[:company].presence || (actor.user? ? current_user.profile&.company_name || current_user.name : actor.name)
    job = current_user.jobs.build(attributes.merge(status: draft ? "draft" : "pending", company:, moderation_note: flags.join("; ").presence))
    job.posted_as_actor = actor
    return render_error(job.errors.full_messages.to_sentence, :unprocessable_content, "VALIDATION_FAILED", fields: job.errors.to_hash(true)) unless job.valid?
    if !draft && (error = submission_error(job))
      return render_error(error, :unprocessable_content)
    end
    repeat = nil
    Job.transaction do
      # One submission per click (A-16): the same listing sent again within seconds, say by a
      # double-click or a retry, answers with the one just created. The user row lock makes the
      # second request wait for the first to commit.
      current_user.lock! unless draft
      repeat = recent_duplicate(job) unless draft
      next if repeat

      if !draft && (limit_error = active_post_limit_error)
        render_error(limit_error, :payment_required, "PLAN_LIMIT")
        raise ActiveRecord::Rollback
      end
      job.save!
    end
    return if performed?
    return render json: { id: repeat.id, status: repeat.status, moderationFlags: repeat.moderation_note.to_s.split("; "), postedAs: repeat.posted_as_json(current_user) }, status: :created if repeat

    audit!("job.create", job, { postedAs: (job.posted_as_page && actor.key) }.compact)
    render json: { id: job.id, status: job.status, moderationFlags: flags, postedAs: job.posted_as_json(current_user) }, status: :created
  end

  def apply
    return unless authenticate!("jobseeker")
    job = Job.published.find(params[:id])
    return render_error("You cannot apply to an opportunity you created.", :conflict) if job.employer_id == current_user.id
    return render_error("The application deadline has passed.", :conflict) if job.application_deadline&.past?
    return render_error("This opportunity requires at least one portfolio item.", :conflict) if job.portfolio_required? && current_user.portfolio_items.none?
    cover_letter = params[:coverLetter]
    return render_error("The note to the hirer must be text.", :unprocessable_content) unless cover_letter.nil? || cover_letter.is_a?(String)
    return render_error("The note to the hirer must be 5,000 characters or fewer.", :unprocessable_content) if cover_letter.to_s.length > 5_000
    answers = screening_answers_for(job)
    return if performed?
    portfolio, resume = chosen_materials
    return if performed?
    application = job.applications.create!(candidate: current_user, cover_letter: cover_letter.presence, screening_answers: answers,
      portfolio:, resume:, materials_snapshot: Application.materials_snapshot(portfolio, resume))
    application.application_events.create!(actor: current_user, event_type: "created", to_status: "Applied")
    Notifier.new_application(application)
    audit!("application.create", application, { portfolioId: portfolio&.id, resumeId: resume&.id }.compact)
    render json: { id: application.id, status: application.status }, status: :created
  rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid => error
    return render_error("You have already applied to this opportunity.", :conflict) if error.to_s.include?("Candidate") || error.to_s.include?("unique")
    raise
  end

  def saved
    return unless authenticate!("jobseeker")
    render json: { jobs: Job.joins(:saved_jobs).where(saved_jobs: { user_id: current_user.id }).with_applications_count.with_posted_as.includes(employer: :profile).order("saved_jobs.created_at DESC").limit(LIST_LIMIT).map { _1.api_json(current_user) } }
  end

  def save
    return unless authenticate!("jobseeker")
    job = Job.published.find(params[:id])
    begin
      SavedJob.find_or_create_by!(user: current_user, job:)
    rescue ActiveRecord::RecordNotUnique
      # A concurrent request saved it first (unique index on user_id, job_id): same outcome.
    end
    render json: { ok: true }, status: :created
  end

  def unsave
    return unless authenticate!("jobseeker")
    SavedJob.where(user: current_user, job_id: params[:id]).delete_all
    render json: { ok: true }
  end

  private

  # The typed search, narrowed to any of the `roles` when given.
  def search_query
    query = Search::Query.new(params[:q])
    roles = params[:roles].to_s.split(",").map { _1.squish.first(40) }.reject(&:blank?).uniq.first(MAX_ROLES)
    roles.any? ? query.and(Search::Query.any_of(roles)) : query
  end

  DUPLICATE_WINDOW = 15.seconds

  # A submitted (not draft) listing by this person that matches `job` and was made moments ago.
  def recent_duplicate(job)
    current_user.jobs.where(status: %w[pending published], created_at: DUPLICATE_WINDOW.ago..)
      .find_by(title: job.title, description: job.description, company: job.company, location: job.location)
  end

  # The portfolio and resume the applicant chose to send (portfolioId/resumeId, both optional).
  # Only the applicant's own: a personal portfolio or one of a Page they manage (not hidden by a
  # moderator), and one of their own resumes. Anything else renders 422.
  def chosen_materials
    return [nil, nil] unless require_scalar_params!(:portfolioId, :resumeId)
    portfolio = resume = nil
    if params[:portfolioId].present?
      owners = ActorResolver.identities_for(current_user)
      portfolio = Portfolio.where(status: "active").where(id: params[:portfolioId].to_s).with_owner.to_a
        .find { |candidate| owners.any? { _1.type == candidate.owner_type && _1.id == candidate.owner_id } }
      unless portfolio
        render_error("Choose one of your own portfolios.", :unprocessable_content, "INVALID_PORTFOLIO", fields: { portfolioId: ["Choose one of your own portfolios."] })
        return [nil, nil]
      end
    end
    if params[:resumeId].present?
      resume = current_user.resumes.includes(:upload).find_by(id: params[:resumeId].to_s)
      unless resume
        render_error("Choose one of your own resumes.", :unprocessable_content, "INVALID_RESUME", fields: { resumeId: ["Choose one of your own resumes."] })
        return [nil, nil]
      end
    end
    [portfolio, resume]
  end

  # Every screening question needs an answer. Answers arrive in question order, either as the bare
  # answer or (older clients) as "Question :: answer"; they are stored as "Question :: answer" so
  # the employer sees each question next to its answer.
  def screening_answers_for(job)
    questions = Array(job.screening_questions).map(&:to_s)
    raw = params[:screeningAnswers]
    raw = Array(raw.is_a?(Array) ? raw : nil).map { _1.is_a?(String) ? _1 : "" }
    return raw.reject(&:empty?).map { _1.first(5_000) } if questions.empty?

    missing = {}
    answers = questions.each_with_index.map do |question, index|
      answer = raw[index].to_s
      answer = answer.delete_prefix("#{question} ::") if answer.start_with?("#{question} ::")
      answer = answer.strip.first(5_000)
      missing["screening_answer_#{index}"] = ["Answer this question: #{question}"] if answer.empty?
      "#{question} :: #{answer}"
    end
    if missing.any?
      count = missing.size
      render_error("Answer #{count == 1 ? 'the screening question' : "all #{count} unanswered screening questions"} before applying.",
        :unprocessable_content, "SCREENING_ANSWERS_REQUIRED", fields: missing)
    end
    answers
  end

  # A whole number is clamped to 1..MAX_PAGE_SIZE; a missing or unreadable one means PAGE_SIZE.
  def page_size
    Integer(params[:limit].to_s, 10).clamp(1, MAX_PAGE_SIZE)
  rescue ArgumentError
    PAGE_SIZE
  end

  # Opaque to clients: the browse order's sort key (published_at, id) of the last job on the
  # page. published_at is nil only for a published job that (defensively) never got one.
  def encode_cursor(job)
    Base64.urlsafe_encode64([job.published_at&.utc&.iso8601(6), job.id].to_json, padding: false)
  end

  # nil without a cursor, false when it cannot be read, else [published_at, id].
  def decode_cursor(raw)
    return nil if raw.blank?
    published_at, id = JSON.parse(Base64.urlsafe_decode64(raw.to_s))
    return false unless (published_at.nil? || published_at.is_a?(String)) && id.is_a?(String) && id.present?
    [published_at && Time.iso8601(published_at), id]
  rescue ArgumentError, JSON::ParserError, TypeError
    false
  end
end
