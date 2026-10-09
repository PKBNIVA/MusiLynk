# Every business-settings file under config/ (Settings::FILES) is parsed and schema-checked when
# the app boots, so a bad edit fails the deploy with the offending key named instead of a request
# failing later. docs/engineering/SETTINGS.md lists the files and their update path.
Rails.application.config.after_initialize { Settings.validate_all! }
