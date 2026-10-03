module Search
  # What each search surface matches (see Search::Document for the weights).
  module Targets
    D = Document
    L = ->(column) { Document.list(column) }

    JOBS = D.new(
      name: "jobs", table: "jobs", key: "id", title: "jobs.title",
      location_vector: "jobs.search_vector", location_text: "jobs.search_text", sources: [[], []],
      weights: {
        "A" => ["jobs.title"],
        "B" => [L.("jobs.skills"), "jobs.function_area", "jobs.opportunity_kind", "jobs.genre"],
        "C" => ["jobs.description", "jobs.requirements", "jobs.company", L.("jobs.languages")],
        "D" => ["jobs.location"]
      }
    )

    # Scopes must join :profile (users is the main table).
    TALENT = D.new(
      name: "talent", table: "profiles", key: "user_id", title: "profiles.headline",
      location_vector: "profiles.search_vector", location_text: "profiles.search_text",
      sources: [["users"], ["users.id = profiles.user_id"]],
      weights: {
        "A" => ["users.name", "profiles.headline"],
        "B" => [L.("profiles.roles"), L.("profiles.skills"), L.("profiles.instruments"), L.("profiles.genres")],
        "C" => ["profiles.bio", L.("profiles.credits"), L.("profiles.gear"), L.("profiles.software"), L.("profiles.event_types"),
          L.("profiles.open_to"), L.("profiles.languages")],
        "D" => ["profiles.location"]
      }
    )

    # Lineup roles and instruments count as act skills ("vocalist" finds bands with a vocalist).
    ACT_MEMBERS = "(SELECT string_agg(concat_ws(' ', search_members.role_name, search_members.instrument), ' ; ') " \
      "FROM act_members search_members WHERE search_members.act_id = acts.id)"

    ACTS = D.new(
      name: "acts", table: "acts", key: "id", title: "acts.name",
      location_vector: "acts.search_vector", location_text: "acts.search_text", sources: [[], []],
      weights: {
        "A" => ["acts.name", "acts.act_type"],
        "B" => [L.("acts.genres"), L.("acts.event_types"), ACT_MEMBERS],
        "C" => ["acts.tagline", "acts.bio", L.("acts.languages")],
        "D" => ["acts.city"]
      }
    )

    # Scopes must join user: :profile (a sample's place is its owner's location).
    SAMPLES = D.new(
      name: "samples", table: "portfolio_items", key: "id", title: "portfolio_items.title",
      location_vector: "profiles.search_vector", location_text: "profiles.search_text", sources: [[], []],
      weights: {
        "A" => ["portfolio_items.title"],
        "B" => [L.("portfolio_items.tags"), L.("portfolio_items.roles"), L.("portfolio_items.genres"), L.("portfolio_items.instruments"),
          "portfolio_items.credited_as"],
        "C" => ["portfolio_items.description"]
      }
    )

    ALL = [JOBS, TALENT, ACTS, SAMPLES].freeze
  end
end
