require "test_helper"
require_relative "relevance_corpus"

# R3 relevance suite: 43 real-world queries (English, Hinglish, Devanagari, typos, city words) and
# the top three each must return, in order, on RelevanceCorpus. A change to the vocabulary
# (config/search_synonyms.yml), the weights (Search::Targets) or the ranking (Search::Query#score)
# that moves any of them fails here with the whole table, so the effect is reviewed, not guessed.
# Fewer than three expected means only those match. "wedding band" and "live band" check that a
# phrase also matches its words scattered through a row (ranked after the in-order phrase);
# "hindustani" checks the fall-back to its broader term when nothing is tagged with it.
class SearchRelevanceTest < ActionDispatch::IntegrationTest
  ENDPOINTS = {
    talent: ["/api/public/talent", "talent", "name"],
    acts: ["/api/public/acts", "acts", "name"],
    jobs: ["/api/jobs", "jobs", "title"],
    samples: ["/api/search?type=samples", "results", "title"]
  }.freeze

  # [type, query, expected top three in order]
  QUERIES = [
    [:talent, "singer", ["Asha Rao", "Kabir Singh", "Sunita Joshi"]],
    [:talent, "गायक", ["Gauri Patil", "Asha Rao", "Kabir Singh"]],
    [:talent, "gayak", ["Neha Pillai", "Asha Rao", "Kabir Singh"]],
    [:talent, "vocalist mumbai", ["Asha Rao"]],
    [:talent, "wedding singer", ["Sanya Arora", "Asha Rao", "Kabir Singh"]],
    [:talent, "shaadi singer", ["Sanya Arora", "Asha Rao", "Kabir Singh"]],
    [:talent, "tabla", ["Arjun Mehta", "Zakir Ali"]],
    [:talent, "tablist", ["Zakir Ali", "Arjun Mehta"]],
    [:talent, "tabla player pune", ["Arjun Mehta"]],
    [:talent, "dhol", ["Gurpreet Sandhu"]],
    [:talent, "dholak", ["Meera Verma"]],
    [:talent, "keys", ["Rahul Khanna"]],
    [:talent, "piano", ["Rahul Khanna"]],
    [:talent, "dj goa", ["Nikhil Kapoor", "Sara Fernandes"]],
    [:talent, "disc jockey", ["Sara Fernandes", "Nikhil Kapoor"]],
    [:talent, "guitarst", ["Vikram Shah", "Ananya Desai"]],
    [:talent, "vocalst", ["Riya Iyer", "Asha Rao", "Kabir Singh"]],
    [:talent, "sufi", ["Kabir Singh"]],
    [:talent, "qawwali", ["Kabir Singh"]],
    [:talent, "ghazal", ["Neha Pillai"]],
    [:talent, "bhajan", ["Sunita Joshi"]],
    [:talent, "anchor", ["Dev Malhotra"]],
    [:talent, "emcee", ["Dev Malhotra"]],
    [:talent, "sound guy", ["Imran Qureshi"]],
    [:talent, "shehnai", ["Farhan Khan"]],
    [:talent, "santoor", ["Rohan Das"]],
    [:talent, "bansuri", ["Priya Menon"]],
    [:talent, "rapper delhi", ["Aman Gill"]],
    [:talent, "ananya desaai", ["Ananya Desai"]],
    [:talent, "hip hop", ["Aman Gill"]],
    [:acts, "shaadi band", ["Shaadi Beats", "Baraat Brass Band", "Weekend Groove"]],
    [:acts, "baraat", ["Baraat Brass Band"]],
    [:acts, "mehndi", ["Mehendi Melodies"]],
    [:acts, "sufi delhi", ["Sufi Sur Collective"]],
    [:acts, "harmonium", ["Sufi Sur Collective", "Shaadi Beats"]],
    [:acts, "jazz quartet", ["Corporate Jazz Quartet"]],
    [:acts, "wedding band", ["Baraat Brass Band", "Shaadi Beats", "Weekend Groove"]],
    [:acts, "live band", ["Live Wire", "Weekend Groove"]],
    [:acts, "hindustani", ["Raag Trio"]],
    [:jobs, "dhol", ["Dhol player for baraat"]],
    [:jobs, "dholak mehendi", ["Dholak player for mehendi night"]],
    [:jobs, "sangeet dj", ["DJ for sangeet"]],
    [:samples, "baraat", ["Baraat dhol beats"]]
  ].freeze

  setup do
    Search::Spelling.reset!
    RelevanceCorpus.build!
  end

  teardown { Search::Spelling.reset! }

  test "43 real-world queries return their expected top three" do
    assert_equal 43, QUERIES.size
    rows = QUERIES.map do |type, query, expected|
      path, key, field = ENDPOINTS.fetch(type)
      get path, params: { q: query }
      assert_response :success
      [type, query, expected, response.parsed_body.fetch(key).first(3).pluck(field)]
    end
    misses = rows.reject { |_, _, expected, actual| expected == actual }
    table = rows.map { |type, query, expected, actual| format("%-3s %-8s %-20s %s%s", expected == actual ? "ok" : "BAD", type, query, actual.inspect, expected == actual ? "" : "  expected #{expected.inspect}") }
    assert_empty misses, "relevance changed:\n#{table.join("\n")}"
  end
end
