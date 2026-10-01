class ProfilesController < ApplicationController
  E164 = /\A\+[1-9]\d{6,14}\z/

  # Opts a musician in (or out) of WhatsApp urgent alerts (see WhatsappAlerts). Kept separate
  # from #update because whatsapp_consented_at is a consent timestamp the server sets, never a
  # value the client hands us directly.
  def whatsapp_consent
    return unless authenticate!("jobseeker", "employer")
    consent = ActiveModel::Type::Boolean.new.cast(params[:consent])
    phone = params[:phoneE164].to_s.strip
    if consent
      return render_error("Enter your number in international format, e.g. +919812345678.", :unprocessable_content, "INVALID_PHONE") unless phone.match?(E164)
    end
    profile = current_user.profile || current_user.build_profile
    profile.phone_e164 = phone.presence
    profile.whatsapp_consented_at = consent && phone.present? ? Time.current : nil
    profile.save!
    audit!("profile.whatsapp_consent", current_user, consented: profile.whatsapp_consented_at.present?)
    render json: { phoneE164: profile.phone_e164, whatsappConsentedAt: profile.whatsapp_consented_at }
  end

  def update
    return unless authenticate!("jobseeker", "employer")
    attributes = profile_params
    attributes["photo_url"] = nil if attributes.key?("photo_url") && attributes["photo_url"].blank?
    field_errors = request_field_errors(attributes)
    profile = current_user.profile || current_user.build_profile
    # Out-of-range numbers must not reach the model (ActiveModel::RangeError on save).
    profile.assign_attributes(attributes.except(*field_errors.keys.map(&:underscore)))
    profile.validate
    profile.errors.to_hash(true).each { |name, messages| (field_errors[name.to_s.camelize(:lower)] ||= []).concat(messages) }
    if field_errors.any?
      # Every problem at once, per field; `error` keeps the whole text for older clients.
      return render_error(field_errors.values.flatten.to_sentence, :unprocessable_content, "VALIDATION_FAILED", fields: field_errors)
    end
    profile.save!
    current_user.update!(profile_complete: true)
    audit!("profile.update", current_user)
    render json: { user: public_user(current_user.reload) }
  end

  private

  CURRENCIES = %w[INR USD EUR GBP].freeze
  # Integer columns: values outside 0..MAX_NUMBER used to raise ActiveModel::RangeError (HTTP 500).
  NUMBER_FIELDS = {
    "years_experience" => "Years of experience", "travel_radius_km" => "Travel radius",
    "hourly_rate" => "Hourly rate", "session_rate" => "Session rate", "show_rate" => "Show rate",
    "tour_day_rate" => "Tour day rate", "day_rate" => "Day rate"
  }.freeze
  MAX_NUMBER = 2_000_000_000

  # Checks that need the raw request values (the model only sees type-cast ones), keyed by the
  # camelCase request field.
  def request_field_errors(attributes)
    errors = {}
    NUMBER_FIELDS.each do |field, label|
      message = invalid_number_message(attributes[field], label)
      errors[field.camelize(:lower)] = [message] if message
    end
    if attributes["currency"].present? && !CURRENCIES.include?(attributes["currency"])
      errors["currency"] = ["Currency must be one of #{CURRENCIES.join(', ')}"]
    end
    # Employers are shown to candidates by their organization name, so it cannot be cleared.
    photo = attributes["photo_url"]
    if photo.present? && photo != current_user.profile&.photo_url && !Upload.photo_owned_by?(current_user, photo)
      errors["photoUrl"] = ["Upload a JPEG, PNG or WebP photo first, then save."]
    end
    if current_user.employer? && attributes.key?("company_name") && attributes["company_name"].to_s.strip.empty?
      errors["companyName"] = ["Enter your company, label or studio name."]
    end
    errors
  end

  def invalid_number_message(raw, label)
    return nil if raw.blank?
    number = Float(raw.to_s, exception: false)
    return "#{label} must be a number" if number.nil? || !number.finite?
    return "#{label} cannot be negative" if number.negative?
    "#{label} is too large" if number > MAX_NUMBER
  end

  def profile_params
    source = params.permit(:headline, :bio, :phone, :location, :experience, :website, :portfolioUrl, :availability,
      :companyName, :companyWebsite, :companySize, :companyDescription, :yearsExperience, :travelRadiusKm,
      :travelsNationally, :travelsInternationally, :remoteRecording, :sightReading, :passportReady,
      :hourlyRate, :sessionRate, :showRate, :tourDayRate, :dayRate, :currency, :shareVerificationPublicly, :photoUrl,
      skills: [], genres: [], instruments: [], languages: [], credits: [], openTo: [], roles: [], gear: [], software: [], eventTypes: [])
    source.to_h.transform_keys { _1.underscore }.slice(*Profile.column_names)
  end
end
