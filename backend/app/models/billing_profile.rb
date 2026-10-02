# An account's billing details for invoices, kept as immutable versions. BillingProfile.save_for
# never edits a row: a change inserts the next version and retires the previous one, so an invoice
# that points at (and snapshots) version 2 is unaffected when the account moves on to version 3.
class BillingProfile < ApplicationRecord
  BUYER_TYPES = %w[individual business].freeze
  PAN_FORMAT = /\A[A-Z]{5}\d{4}[A-Z]\z/
  PIN_FORMAT = /\A[1-9]\d{5}\z/
  PO_FORMAT = /\A[A-Za-z0-9][A-Za-z0-9 \-_.\/#]*\z/
  EMAIL_FORMAT = /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/
  EDITABLE = %i[buyer_type legal_name gstin pan address_line1 address_line2 city state_code postal_code billing_email po_reference].freeze

  belongs_to :user
  has_many :tax_invoices, dependent: :nullify

  scope :current, -> { where(current: true) }

  before_validation :normalise

  validates :buyer_type, inclusion: { in: BUYER_TYPES }
  validates :legal_name, presence: { message: "Enter the name to print on the invoice." }, length: { in: 2..120, message: "Use 2 to 120 characters.", allow_blank: true }
  validates :address_line1, presence: { message: "Enter the first line of your address." }, length: { maximum: 120 }
  validates :address_line2, length: { maximum: 120 }
  validates :city, presence: { message: "Enter your city." }, length: { maximum: 80 }
  validates :state_code, inclusion: { in: IndianStates::STATES.keys, message: "Choose your state." }
  validates :postal_code, format: { with: PIN_FORMAT, message: "Enter a 6-digit PIN code." }
  validates :billing_email, format: { with: EMAIL_FORMAT, message: "Enter a valid email address." }, length: { maximum: 254 }
  validates :po_reference, length: { maximum: 40 }, format: { with: PO_FORMAT, message: "Use letters, numbers and - _ . / # only." }, allow_blank: true
  validates :country, inclusion: { in: ["India"] }
  validate :tax_ids_are_valid

  def self.current_for(user) = where(user_id: user.id, current: true).first

  # Saves `attributes` as the account's current billing details. Returns the existing current
  # version when nothing changed, a new version otherwise, or an unsaved invalid record carrying
  # the errors (nothing is written then).
  def self.save_for(user, attributes)
    user.with_lock do
      current = current_for(user)
      candidate = new(user:, **attributes.slice(*EDITABLE))
      candidate.billing_email = user.email if candidate.billing_email.blank?
      candidate.valid?
      next candidate unless candidate.errors.empty?
      next current if current && current.same_details?(candidate)

      candidate.version = (where(user_id: user.id).maximum(:version) || 0) + 1
      transaction do
        current&.update_columns(current: false, updated_at: Time.current)
        candidate.current = true
        candidate.save!
      end
      candidate
    end
  end

  def business? = buyer_type == "business"
  def state_name = IndianStates.name(state_code)

  def same_details?(other)
    EDITABLE.all? { public_send(_1).to_s == other.public_send(_1).to_s }
  end

  # What an invoice stores about the buyer; plain strings, no references to this row's future.
  def snapshot
    { type: buyer_type, name: legal_name, gstin: gstin.to_s, pan: pan.to_s, addressLine1: address_line1, addressLine2: address_line2.to_s,
      city:, state: state_name, stateCode: state_code, postalCode: postal_code, country:, email: billing_email, poReference: po_reference.to_s,
      profileVersion: version }
  end

  def as_json_for_owner(*)
    { buyerType: buyer_type, legalName: legal_name, gstin: gstin.to_s, pan: pan.to_s, addressLine1: address_line1, addressLine2: address_line2.to_s,
      city:, stateCode: state_code, state: state_name, postalCode: postal_code, country:, billingEmail: billing_email, poReference: po_reference.to_s,
      version:, updatedAt: created_at }
  end

  private

  def normalise
    %i[legal_name address_line1 address_line2 city po_reference billing_email].each { |field| self[field] = self[field].to_s.squish.presence }
    self.billing_email = billing_email&.downcase
    self.gstin = Gstin.normalize(gstin).presence
    self.pan = pan.to_s.strip.upcase.delete(" ").presence
    self.postal_code = postal_code.to_s.delete(" ")
    self.state_code = state_code.to_s.strip
    self.country = "India"
    # An individual has no GST or PAN details on an invoice.
    self.gstin = self.pan = nil unless business?
  end

  def tax_ids_are_valid
    if gstin
      errors.add(:gstin, Gstin.error_for(gstin)) if Gstin.error_for(gstin)
      if Gstin.valid?(gstin)
        errors.add(:gstin, "This GSTIN is for #{IndianStates.name(Gstin.state_code(gstin))}, but you chose #{state_name || 'another state'}. Pick the state on your GST registration.") if Gstin.state_code(gstin) != state_code
        errors.add(:pan, "This PAN does not match the PAN inside your GSTIN.") if pan && pan != Gstin.pan(gstin)
      end
    end
    errors.add(:pan, "Enter a 10-character PAN, like ABCDE1234F.") if pan && !pan.match?(PAN_FORMAT)
  end
end
