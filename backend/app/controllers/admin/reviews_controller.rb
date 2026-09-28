module Admin
  class ReviewsController < BaseController
    include AdminPagination

    def index
      rows, meta = admin_paginate(Review.includes(:author, employer: :profile).order(created_at: :desc), default_per: 100)
      render json: {
        reviews: rows.map { _1.attributes.merge(authorName: _1.author.name, employerName: _1.employer.profile&.company_name || _1.employer.name) }
      }.merge(meta)
    end
    def update
      return render_error("Invalid review status.", :bad_request) unless %w[published rejected].include?(params[:status])
      review = Review.find(params[:id]); review.update!(status: params[:status]); audit!("admin.review.status", review); render json: { ok: true }
    end
  end
end
