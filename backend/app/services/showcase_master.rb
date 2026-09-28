# The master copy of the fields portfolios and resumes inherit. A portfolio or resume stores an
# override only when the owner deliberately sets one; otherwise the value shown is read from here,
# so editing the profile (or the act/organization) updates every view at once.
#
# - A person: headline, bio, city (location), genres and rates from their profile. Rates come
#   from the first profile rate that is set (session, show, day, tour day, hourly).
# - An act: tagline as headline, bio, city, genres, and its fee range and basis as rates.
# - An organization: its city (it has no headline, bio, genres or rates of its own).
module ShowcaseMaster
  PROFILE_RATES = [%w[session_rate session], %w[show_rate show], %w[day_rate day], %w[tour_day_rate day], %w[hourly_rate hour]].freeze

  module_function

  def for(owner)
    case owner
    when User then user(owner)
    when Act then act(owner)
    when Organization then { "headline" => nil, "bio" => nil, "city" => owner.city.presence, "genres" => [], "rates" => nil }
    else { "headline" => nil, "bio" => nil, "city" => nil, "genres" => [], "rates" => nil }
    end
  end

  def user(user)
    profile = user.profile
    return { "headline" => nil, "bio" => nil, "city" => nil, "genres" => [], "rates" => nil, "summary" => nil } unless profile
    column, basis = PROFILE_RATES.find { |name, _| profile[name].present? }
    rates = column && { "min" => profile[column], "max" => profile[column], "currency" => profile.currency.presence || "INR", "basis" => basis }
    { "headline" => profile.headline.presence, "bio" => profile.bio.presence, "city" => profile.location.presence,
      "genres" => Array(profile.genres), "rates" => rates, "summary" => profile.bio.presence }
  end

  def act(act)
    rates = (act.min_fee || act.max_fee) && { "min" => act.min_fee, "max" => act.max_fee, "currency" => act.currency, "basis" => act.fee_basis }.compact
    { "headline" => act.tagline.presence, "bio" => act.bio.presence, "city" => act.city.presence, "genres" => Array(act.genres), "rates" => rates }
  end
end
