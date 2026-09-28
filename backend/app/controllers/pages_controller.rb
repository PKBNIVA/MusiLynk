# Public views of a Page (an organization or an act).
class PagesController < ApplicationController
  LIST_LIMIT = 100

  # GET /api/pages/:type/:id/jobs: the published jobs posted as this Page, newest first.
  def jobs
    type = params[:type].to_s
    page = PageDirectory::TYPES.include?(type) ? PageDirectory.find(type, params[:id].to_s) : nil
    return render_error("Page not found", :not_found) unless page && PageDirectory.public?(page)

    jobs = Job.published.posted_as(type, page.id).with_applications_count.with_posted_as.includes(employer: :profile)
      .order(featured: :desc, created_at: :desc, id: :desc).limit(LIST_LIMIT)
    # Same rule as the job board: non-demo synthetic QA batches are only listed to synthetic viewers.
    jobs = SyntheticQa::Demo.publicly_listed(jobs.joins(:employer)) unless current_user&.synthetic_batch.present?
    render json: { page: PageDirectory.ref(type, page), jobs: jobs.map { _1.api_json(current_user) } }
  end
end
