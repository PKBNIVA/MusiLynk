# Lets a musician opt in to WhatsApp urgent alerts (WhatsappAlerts). Additive columns only;
# both are null until the person sets them, and the alert is sent only when both are present.
class AddWhatsappConsentToProfiles < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :profiles, :phone_e164, :string
    add_column :profiles, :whatsapp_consented_at, :datetime
  end
end
