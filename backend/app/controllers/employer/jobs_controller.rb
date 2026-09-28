module Employer
  # The poster's own opportunities: list, edit fields and move between owner-controlled statuses.
  class JobsController < ApplicationController
    include JobAuthoring
    include ActingAs

    # Owner-initiated status changes. Publishing is the moderator's decision (admin/jobs).
    OWNER_TRANSITIONS = {
      "draft" => %w[pending closed],
      "pending" => %w[draft closed],
      "published" => %w[closed],
      "rejected" => %w[draft pending closed],
      "closed" => %w[pending draft]
    }.freeze

    def index
      return unless authenticate!("jobseeker", "employer")
      return unless require_scalar_params!(:postedAs)
      jobs = current_user.jobs.with_applications_count.with_posted_as.includes(employer: :profile).order(updated_at: :desc).limit(200)
      if params[:postedAs].present?
        type, id = params[:postedAs].to_s.split(":", 2)
        return render_error("postedAs must be \"user:<id>\", \"organization:<id>\" or \"act:<id>\".", :bad_request, "INVALID_FILTER") unless ActorResolver::TYPES.include?(type) && id.present?
        # "user:…" is the personal posts (only your own id matches anything).
        jobs = type == "user" ? jobs.where(posted_as_type: nil).where(employer_id: id) : jobs.posted_as(type, id)
      end
      render json: { jobs: jobs.map { owner_json(_1) } }
    end

    def update
      return unless authenticate!("jobseeker", "employer")
      return unless require_scalar_params!(:status, :company, :postedAs)
      job = current_user.jobs.find(params[:id])
      return unless (actor = current_actor)
      # Which identity the job is posted as after this edit: an explicit `postedAs` key (any
      # identity you can act as, "user:<your id>" to post it personally again), else the Page you
      # are acting as. Acting as yourself without `postedAs` leaves it as it was, so older
      # clients never detach a job from its Page.
      if params.key?(:postedAs)
        target_actor = ActorResolver.resolve(current_user, params[:postedAs].presence || "user:#{current_user.id}")
        return render_error("You can't post as that page.", :forbidden, "ACT_AS_FORBIDDEN") unless target_actor
      elsif !actor.user?
        target_actor = actor
      end
      requested = params[:status].presence
      if requested
        return render_error("Invalid opportunity status.", :bad_request) unless OWNER_TRANSITIONS.key?(requested)
        if requested != job.status && !OWNER_TRANSITIONS.fetch(job.status, []).include?(requested)
          return render_error("An opportunity that is #{job.status} cannot be moved to #{requested}.", :conflict)
        end
      end

      attributes = job_params
      if target_actor
        job.posted_as_actor = target_actor
        # Moving to a Page without naming a company: the listing carries the Page's name.
        job.company = target_actor.name if params[:company].blank? && job.posted_as_id_changed? && !target_actor.user?
      end
      reattached = job.posted_as_type_changed? || job.posted_as_id_changed?
      return render_error("No opportunity changes supplied.", :bad_request) if requested.nil? && attributes.empty? && params[:company].blank? && !reattached
      edited = reattached || attributes.any? { |key, value| job.public_send(key) != job.class.type_for_attribute(key).cast(value) }
      if edited && job.closed? && requested.nil?
        return render_error("Reopen or save this opportunity as a draft to edit it.", :conflict)
      end
      job.assign_attributes(attributes)
      job.company = params[:company] if params[:company].present?
      # A live listing that changes goes back to review so moderated content stays moderated.
      target = requested || ((job.published? || job.rejected?) && edited ? "pending" : job.status)
      job.status = target
      if edited
        flags = moderation_flags_for(job.attributes)
        job.moderation_note = flags.join("; ").presence
      end
      return render_error(job.errors.full_messages.to_sentence, :unprocessable_content, "VALIDATION_FAILED", fields: job.errors.to_hash(true)) unless job.valid?
      if target == "pending" && (error = submission_error(job))
        return render_error(error, :unprocessable_content)
      end

      Job.transaction do
        if target == "pending" && !JobAuthoring::ACTIVE_STATUSES.include?(job.status_in_database) && (limit_error = active_post_limit_error(except: job))
          render_error(limit_error, :payment_required, "PLAN_LIMIT")
          raise ActiveRecord::Rollback
        end
        job.save!
      end
      return if performed?
      audit!(edited ? "job.update" : "job.status", job, { status: job.status, postedAs: (target_actor.key if reattached) }.compact)
      render json: { ok: true, job: owner_json(job.reload) }
    end

    private

    def owner_json(job)
      job.api_json(current_user).merge("applications" => job.applications_count, "allowedNextStatuses" => OWNER_TRANSITIONS.fetch(job.status, []))
    end
  end
end
