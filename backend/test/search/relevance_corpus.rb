# The relevance suite's marketplace: a small slice shaped like the scout seed (/home/user/plan/scout/
# seed.rb: "<Role> from <City>" headlines, role/instrument/genre/event lists, acts with lineups,
# "<Role> needed for <event>" jobs, tagged work samples) plus the Indian vocabulary the seed lacks
# (dhol next to dholak, shehnai, anchors, bhajan, mehendi, Devanagari). Every person signed in at a
# different time, so ties in relevance fall back to the directory order deterministically.
module RelevanceCorpus
  PASSWORD = "StrongPass123!".freeze

  # name, headline, location, roles, instruments, genres, event_types, languages
  PEOPLE = [
    ["Asha Rao", "Playback singer from Mumbai", "Mumbai, Maharashtra", ["Vocalist"], [], ["Bollywood"], ["Wedding", "Sangeet"], ["Hindi", "Marathi"]],
    ["Riya Iyer", "Carnatic vocalist from Chennai", "Chennai, Tamil Nadu", ["Vocalist"], [], ["Carnatic"], ["Private party"], ["Tamil"]],
    ["Kabir Singh", "Sufi singer and qawwal", "Delhi", ["Vocalist", "Qawwal"], ["Harmonium"], ["Sufi", "Qawwali"], ["Wedding"], ["Hindi", "Urdu"]],
    ["Neha Pillai", "Ghazal gayika from Lucknow", "Lucknow, Uttar Pradesh", ["Vocalist"], [], ["Ghazal"], ["Private party"], ["Urdu"]],
    ["Arjun Mehta", "Tabla player from Pune", "Pune, Maharashtra", ["Tabla Player"], ["Tabla"], ["Hindustani"], ["Studio session"], ["Marathi"]],
    ["Zakir Ali", "Tablist for fusion gigs", "Mumbai, Maharashtra", ["Percussionist"], ["Tabla", "Cajon"], ["Fusion"], ["Club"], ["Hindi"]],
    ["Gurpreet Sandhu", "Dhol player for baraats", "Chandigarh", ["Dhol Player"], ["Dhol"], ["Folk"], ["Baraat", "Wedding"], ["Punjabi"]],
    ["Meera Verma", "Dholak player from Jaipur", "Jaipur, Rajasthan", ["Dholak Player"], ["Dholak"], ["Folk"], ["Mehendi", "Sangeet"], ["Hindi"]],
    ["Rahul Khanna", "Keyboardist and pianist", "Bengaluru, Karnataka", ["Keyboardist"], ["Piano", "Keyboard"], ["Jazz"], ["Corporate"], ["English"]],
    ["Vikram Shah", "Session guitarist from Mumbai", "Mumbai, Maharashtra", ["Guitarist"], ["Electric Guitar"], ["Rock"], ["Studio session"], ["Hindi"]],
    ["Ananya Desai", "Guitar teacher", "Pune, Maharashtra", ["Guitarist", "Music Teacher"], ["Acoustic Guitar"], [], [], ["Marathi"]],
    ["Nikhil Kapoor", "Wedding DJ from Goa", "Goa", ["DJ"], ["Turntables"], ["Bollywood", "EDM"], ["Wedding", "Sangeet", "Club"], ["English"]],
    ["Sara Fernandes", "Disc jockey and producer", "Panaji, Goa", ["DJ", "Music Producer"], [], ["EDM"], ["Club"], ["English", "Konkani"]],
    ["Imran Qureshi", "FOH sound engineer", "Hyderabad, Telangana", ["Sound Engineer"], [], [], ["Festival", "Corporate"], ["Urdu"]],
    ["Pooja Nair", "Mixing and mastering engineer", "Kochi, Kerala", ["Mixing Engineer", "Mastering Engineer"], [], ["Indie"], ["Studio session"], ["Malayalam"]],
    ["Farhan Khan", "Shehnai vadak", "Varanasi, Uttar Pradesh", ["Shehnai Player"], ["Shehnai"], ["Hindustani"], ["Wedding"], ["Hindi"]],
    ["Lakshmi Iyer", "Violinist from Chennai", "Chennai, Tamil Nadu", ["Violinist"], ["Violin"], ["Carnatic"], ["Private party"], ["Tamil"]],
    ["Dev Malhotra", "Event anchor and emcee", "Delhi", ["Anchor"], [], [], ["Corporate", "Wedding"], ["Hindi", "English"]],
    ["Sunita Joshi", "Bhajan and kirtan singer", "Indore, Madhya Pradesh", ["Vocalist"], ["Harmonium"], ["Bhajan", "Kirtan"], ["Devotional"], ["Hindi"]],
    ["Karan Batra", "Drummer from Bengaluru", "Bengaluru, Karnataka", ["Drummer"], ["Drums"], ["Rock", "Metal"], ["Festival"], ["Kannada"]],
    ["Tanvi Kulkarni", "Lyricist from Mumbai", "Mumbai, Maharashtra", ["Lyricist"], [], ["Bollywood"], [], ["Hindi", "Marathi"]],
    ["Rohan Das", "Santoor player from Kolkata", "Kolkata, West Bengal", ["Santoor Player"], ["Santoor"], ["Hindustani"], [], ["Bengali"]],
    ["Priya Menon", "Flautist from Bengaluru", "Bengaluru, Karnataka", ["Flautist"], ["Bansuri"], ["Carnatic"], ["Studio session"], ["Kannada"]],
    ["Aman Gill", "Rapper from Delhi", "Delhi", ["Rapper"], [], ["Hip-hop"], ["Club"], ["Punjabi"]],
    ["Sanya Arora", "Wedding singer from Delhi", "Delhi", ["Vocalist"], [], ["Bollywood"], ["Wedding", "Sangeet", "Mehendi"], ["Hindi", "Punjabi"]],
    ["Gauri Patil", "गायिका, पुणे", "Pune, Maharashtra", ["Vocalist"], [], ["Folk"], [], ["Marathi"]]
  ].freeze

  # name, act_type, city, genres, event_types, lineup [[role, instrument], ...], tagline
  ACTS = [
    ["Baraat Brass Band", "Wedding band", "Jaipur", ["Folk"], ["Baraat", "Wedding"], [["Dhol Player", "Dhol"], ["Trumpeter", "Trumpet"]]],
    ["Shaadi Beats", "Wedding band", "Delhi", ["Bollywood"], ["Wedding", "Sangeet"], [["Vocalist", nil], ["Keyboardist", "Keys"], ["Dholak Player", "Dholak"]]],
    ["Sufi Sur Collective", "Sufi group", "Delhi", ["Sufi", "Qawwali"], ["Wedding", "Private party"], [["Qawwal", "Harmonium"], ["Tabla Player", "Tabla"]]],
    ["Electric Monsoon", "Band", "Bengaluru", ["Rock"], ["Festival", "Club"], [["Guitarist", "Guitar"], ["Drummer", "Drums"], ["Vocalist", nil]]],
    ["Groove Theory DJs", "DJ", "Goa", ["EDM", "Bollywood"], ["Club", "Wedding"], [["DJ", "Turntables"]]],
    ["Raag Trio", "Trio", "Pune", ["Classical"], ["Private party"], [["Sitarist", "Sitar"], ["Tabla Player", "Tabla"], ["Flautist", "Bansuri"]]],
    ["Mehendi Melodies", "Duo", "Jaipur", ["Folk"], ["Mehendi", "Sangeet"], [["Dholak Player", "Dholak"], ["Vocalist", nil]]],
    ["Corporate Jazz Quartet", "Band", "Mumbai", ["Jazz"], ["Corporate"], [["Pianist", "Piano"], ["Saxophonist", "Saxophone"]]],
    ["Live Wire", "Live band", "Mumbai", ["Rock"], ["Club", "Festival"], [["Guitarist", "Guitar"], ["Drummer", "Drums"]]],
    ["Weekend Groove", "Band", "Pune", ["Pop"], ["Wedding", "Corporate"], [["Vocalist", nil], ["Bassist", "Bass"]],
      "Live covers for the dance floor: the band every wedding asks back"]
  ].freeze

  # title, location, skills, genre
  JOBS = [
    ["Dhol player for baraat", "Delhi", ["Dhol Player"], "Folk"],
    ["Dholak player for mehendi night", "Jaipur, Rajasthan", ["Dholak Player"], "Folk"],
    ["Wedding singer needed", "Mumbai, Maharashtra", ["Vocalist"], "Bollywood"],
    ["Tabla player for studio session", "Pune, Maharashtra", ["Tabla Player"], "Hindustani"],
    ["DJ for sangeet", "Goa", ["DJ"], "Bollywood"],
    ["Keyboard player for corporate gala", "Bengaluru, Karnataka", ["Keyboardist"], "Jazz"],
    ["Sound engineer for live concert", "Hyderabad, Telangana", ["Sound Engineer"], "Rock"],
    ["Guitarist for rock band tour", "Mumbai, Maharashtra", ["Guitarist"], "Rock"],
    ["Anchor for corporate event", "Delhi", ["Anchor"], "Corporate"],
    ["Shehnai player for wedding ceremony", "Varanasi, Uttar Pradesh", ["Shehnai Player"], "Hindustani"]
  ].freeze

  # owner, title, tags, genres, instruments
  SAMPLES = [
    ["Asha Rao", "Bollywood wedding medley", ["wedding", "live"], ["Bollywood"], []],
    ["Kabir Singh", "Qawwali night live", ["live"], ["Qawwali"], ["Harmonium"]],
    ["Arjun Mehta", "Teentaal tabla solo", ["solo"], ["Hindustani"], ["Tabla"]],
    ["Nikhil Kapoor", "Sangeet DJ mix 2026", ["mix"], ["Bollywood", "EDM"], ["Turntables"]],
    ["Gurpreet Sandhu", "Baraat dhol beats", ["baraat"], ["Folk"], ["Dhol"]]
  ].freeze

  module_function

  def build!
    now = Time.current
    people = PEOPLE.each_with_index.to_h do |(name, headline, location, roles, instruments, genres, event_types, languages), index|
      user = User.create!(name:, email: "relevance-#{index}@example.com", password: PASSWORD, role: "jobseeker", status: "active",
        profile_complete: true, last_login_at: now - index.hours)
      user.create_profile!(headline:, location:, roles:, instruments:, genres:, event_types:, languages:)
      [name, user]
    end
    hirer = User.create!(name: "Relevance Hirer", email: "relevance-hirer@example.com", password: PASSWORD, role: "employer", status: "active", profile_complete: true)
    hirer.create_profile!(company_name: "Relevance Events")
    ACTS.each_with_index do |(name, act_type, city, genres, event_types, lineup, tagline), index|
      act = Act.create!(owner: people.values[index], name:, act_type:, city:, genres:, event_types:, tagline:, currency: "INR", fee_basis: "event", status: "active")
      act.update_columns(updated_at: now - index.hours)
      lineup.each { |role, instrument| act.act_members.create!(display_name: role, role_name: role, instrument:, member_status: "confirmed") }
    end
    JOBS.each_with_index do |(title, location, skills, genre), index|
      Job.create!(employer: hirer, title:, company: "Relevance Events", location:, kind: "Contract", genre:, skills:, status: "published",
        description: "#{title}. Paid engagement with written terms, a sound check and a clear schedule.", created_at: now - index.hours)
    end
    SAMPLES.each_with_index do |(owner, title, tags, genres, instruments), index|
      PortfolioItem.create!(user: people.fetch(owner), kind: "audio", title:, tags:, genres:, instruments:, visibility: "public",
        url: "https://example.com/sample-#{index}.mp3", updated_at: now - index.hours)
    end
    people
  end
end
