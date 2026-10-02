#!/usr/bin/env python3
"""Owner-approved Railway variable maintenance for Verse. Never prints a variable value.

Usage:
  railway_vars.py verify            names + lengths of the relevant variables on web and worker
  railway_vars.py apply             owner items: annual plan ids (web+worker), fresh encryption keys (web),
                                    worker references to the web service's shared keys, remove the invalid
                                    Google client values on web
  railway_vars.py set SERVICE K=V.. set literal (non-secret) values, e.g. RAZORPAY_REFERRAL_OFFER_ID=offer_x
"""
import json, os, secrets, sys, urllib.request

API = "https://backboard.railway.com/graphql/v2"
PROJECT = "ae393a2b-eca4-4b45-b013-910c8940a69d"
ENV = "64a015d7-56db-4f27-a769-c76b6f3e3b81"
SERVICES = {"web": "f4aa687b-0c78-447f-baa6-9fcc43649da3", "worker": "d4e153d1-f116-4c54-acbe-7bd921def7aa"}
ENC_KEYS = ["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY", "ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY", "ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"]
SHARED = ["YOUTUBE_API_KEY", "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", *ENC_KEYS]
PLANS = {"RAZORPAY_PLAN_PRO_ANNUAL": "plan_TiB37BQTLWeAB5", "RAZORPAY_PLAN_STUDIO_ANNUAL": "plan_TiB38G2szJFREC"}
WATCH = [*PLANS, *SHARED, "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "API_URL", "RAZORPAY_REFERRAL_OFFER_ID", "RAZORPAY_ALLOW_TEST_MODE"]


def gql(query, variables=None):
    req = urllib.request.Request(API, data=json.dumps({"query": query, "variables": variables or {}}).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ["RAILWAY_TOKEN"].strip(), "User-Agent": "verse-ops"})
    try:
        body = json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"railway http {e.code}: {e.read()[:300].decode()}")
    if body.get("errors"):
        raise SystemExit("railway error: " + json.dumps(body["errors"])[:400])
    return body["data"]


def variables(service):
    return gql("query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }",
               {"p": PROJECT, "e": ENV, "s": SERVICES[service]})["variables"]


def upsert(service, values):
    gql("mutation($i:VariableCollectionUpsertInput!){ variableCollectionUpsert(input:$i) }",
        {"i": {"projectId": PROJECT, "environmentId": ENV, "serviceId": SERVICES[service], "variables": values}})
    print(f"{service}: set {sorted(values)}")


def delete(service, name):
    gql("mutation($i:VariableDeleteInput!){ variableDelete(input:$i) }",
        {"i": {"projectId": PROJECT, "environmentId": ENV, "serviceId": SERVICES[service], "name": name}})
    print(f"{service}: deleted {name}")


def verify():
    vals = {s: variables(s) for s in SERVICES}
    for s, v in vals.items():
        print(s, {k: (len(v[k]) if k in v else None) for k in WATCH})
    same = [k for k in SHARED if vals["web"].get(k) is not None and vals["web"].get(k) == vals["worker"].get(k)]
    print("shared keys identical on web and worker:", same)
    google = vals["web"].get("GOOGLE_OAUTH_CLIENT_ID", "")
    print("google client id looks real:", google.endswith(".apps.googleusercontent.com") if google else "absent")


def apply():
    web_name = gql("query($id:String!){ service(id:$id){ name } }", {"id": SERVICES["web"]})["service"]["name"]
    print("web service name:", web_name)
    web = variables("web")
    for k in ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"):
        if k in web and not web.get("GOOGLE_OAUTH_CLIENT_ID", "").endswith(".apps.googleusercontent.com"):
            delete("web", k)
    new_web = dict(PLANS)
    for k in ENC_KEYS:
        if not web.get(k):
            new_web[k] = secrets.token_hex(32)
    upsert("web", new_web)
    refs = {k: "${{" + web_name + "." + k + "}}" for k in SHARED}
    upsert("worker", {**PLANS, **refs})
    verify()


def set_literal(service, pairs):
    values = dict(p.split("=", 1) for p in pairs)
    if any(k not in ("RAZORPAY_REFERRAL_OFFER_ID", *PLANS, "RAZORPAY_ALLOW_TEST_MODE", "WHATSAPP_TEMPLATE_URGENT", "WHATSAPP_TEMPLATE_OTP", "WHATSAPP_ENABLED", "API_URL",
                                "ALLOWED_ORIGINS", "ADMIN_ORIGIN", "FRONTEND_URL", "FRONTEND_HOST", "WEB_CONCURRENCY") for k in values):
        raise SystemExit("set: only non-secret identifiers may be passed on the command line")
    upsert(service, values)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if cmd == "verify":
        verify()
    elif cmd == "apply":
        apply()
    elif cmd == "set" and len(sys.argv) >= 4:
        set_literal(sys.argv[2], sys.argv[3:])
    else:
        raise SystemExit(__doc__)
