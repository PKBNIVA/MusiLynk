# A request that arrives through Vercel keeps the edge's id (lib/edge_request_id.rb). Must run
# before ActionDispatch::RequestId, which reads X-Request-Id or generates one.
require_relative "../../lib/edge_request_id"

Rails.application.config.middleware.insert_before ActionDispatch::RequestId, EdgeRequestId
