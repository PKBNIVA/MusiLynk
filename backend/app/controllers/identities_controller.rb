# Lists the identities the signed-in person can act as, for the header switcher.
class IdentitiesController < ApplicationController
  before_action -> { authenticate!("jobseeker", "employer") }

  def index
    render json: { identities: ActorResolver.identities_for(current_user).map(&:as_json) }
  end
end
