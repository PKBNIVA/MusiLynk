# Pages are the organizations and acts a person can act as (see ActorResolver). Jobs and
# portfolios refer to one by the ActorResolver type ("organization"/"act") and its id; this is
# where those references are resolved and where "may the public see this Page" is decided.
module PageDirectory
  TYPES = %w[organization act].freeze
  # Owners of a portfolio: a person or a Page.
  OWNER_TYPES = %w[user organization act].freeze

  module_function

  def model_for(type)
    case type
    when "user" then User
    when "organization" then Organization
    when "act" then Act
    end
  end

  def find(type, id) = model_for(type)&.find_by(id:)

  # Organizations are public while active; acts while active (not draft, inactive or hidden by a
  # moderator); a person while their account is active.
  def public?(record)
    case record
    when Organization, Act then record.status == "active"
    when User then record.active?
    else false
    end
  end

  def ref(type, record) = { type:, id: record.id, name: record.name }
end
