class CatalogController < ApplicationController
  # Lists live in config/catalog.yml (Catalog); these constants keep their historical names.
  ROLE_CATEGORIES = Catalog.role_categories
  ACT_TYPES = Catalog.act_types.freeze
  EVENT_TYPES = Catalog.event_types.freeze
  ENGAGEMENT_TYPES = Catalog.engagement_types.freeze
  INSTRUMENTS = Catalog.instruments.freeze

  def taxonomy
    render json: {
      opportunityKinds: Catalog.opportunity_kinds,
      # Search::Taxonomy is the single list for posting, filters, job alerts and the directory tiles.
      **Search::Taxonomy.as_json,
      workplaces: Catalog.workplaces, currencies: Catalog.currencies,
      actTypes: ACT_TYPES, eventTypes: EVENT_TYPES, engagementTypes: ENGAGEMENT_TYPES,
      roleCategories: ROLE_CATEGORIES, instruments: INSTRUMENTS
    }
  end
end
