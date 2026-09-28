module Search
  # What each search surface matches, by weight (see Query#score).
  module Targets
    F = Query::Fields

    JOBS = F.new(
      primary: ["jobs.title"],
      secondary: ["jobs.skills::text", "jobs.function_area", "jobs.opportunity_kind", "jobs.genre"],
      tertiary: ["jobs.description", "jobs.requirements", "jobs.company"],
      location: ["jobs.location"]
    )

    # Scopes must join :profile.
    TALENT = F.new(
      primary: ["profiles.headline", "users.name"],
      secondary: ["profiles.roles::text", "profiles.skills::text", "profiles.instruments::text", "profiles.genres::text"],
      tertiary: ["profiles.bio", "profiles.credits::text", "profiles.gear::text", "profiles.software::text"],
      location: ["profiles.location"]
    )

    # Lineup roles and instruments count as act skills ("vocalist" finds bands with a vocalist).
    ACT_MEMBERS = "(SELECT string_agg(concat_ws(' ', search_members.role_name, search_members.instrument), ' ; ') " \
      "FROM act_members search_members WHERE search_members.act_id = acts.id)"

    ACTS = F.new(
      primary: ["acts.name", "acts.act_type"],
      secondary: ["acts.genres::text", "acts.event_types::text", ACT_MEMBERS],
      tertiary: ["acts.tagline", "acts.bio"],
      location: ["acts.city"]
    )

    # Scopes must join user: :profile.
    SAMPLES = F.new(
      primary: ["portfolio_items.title"],
      secondary: ["portfolio_items.tags::text", "portfolio_items.roles::text", "portfolio_items.genres::text",
        "portfolio_items.instruments::text", "portfolio_items.credited_as"],
      tertiary: ["portfolio_items.description"],
      location: ["profiles.location"]
    )
  end
end
