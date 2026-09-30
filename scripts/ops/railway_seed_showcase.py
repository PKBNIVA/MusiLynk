#!/usr/bin/env python3
"""Owner-approved one-off: seed the Verse showcase on production through a Railway pre-deploy command.

Usage:
  railway_seed_showcase.py check     names only: AWS/bucket variables present on the web service, current preDeployCommand
  railway_seed_showcase.py seed      set preDeployCommand to db:prepare + demo:showcase, redeploy, wait, print demo:showcase log lines, reset command
  railway_seed_showcase.py reset     clear preDeployCommand
  railway_seed_showcase.py status    latest deployments of web and worker
Never prints a variable value.
"""
import json, os, sys, time, urllib.request

API = "https://backboard.railway.com/graphql/v2"
PROJECT = "ae393a2b-eca4-4b45-b013-910c8940a69d"
ENV = "64a015d7-56db-4f27-a769-c76b6f3e3b81"
WEB = "f4aa687b-0c78-447f-baa6-9fcc43649da3"
WORKER = "d4e153d1-f116-4c54-acbe-7bd921def7aa"
SEED_CMD = ["bash -lc 'bin/rails db:prepare && bin/rails demo:showcase'"]


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


def instance():
    return gql("query($s:String!,$e:String!){ serviceInstance(serviceId:$s, environmentId:$e){ preDeployCommand startCommand latestDeployment{ id status createdAt } } }",
               {"s": WEB, "e": ENV})["serviceInstance"]


def set_pre_deploy(value):
    gql("mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$s, environmentId:$e, input:$i) }",
        {"s": WEB, "e": ENV, "i": {"preDeployCommand": value}})
    print("preDeployCommand now:", json.dumps(instance()["preDeployCommand"]))


def check():
    v = gql("query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }", {"p": PROJECT, "e": ENV, "s": WEB})["variables"]
    names = sorted(k for k in v if any(t in k.upper() for t in ("AWS", "S3", "R2", "BUCKET")))
    print("bucket-related variable names on web:", names)
    print("AWS_BUCKET present:", "AWS_BUCKET" in v)
    print("current preDeployCommand:", json.dumps(instance()["preDeployCommand"]))


def status():
    for name, sid in (("web", WEB), ("worker", WORKER)):
        r = gql("query($s:String!,$e:String!){ deployments(input:{serviceId:$s, environmentId:$e}, first:3){ edges{ node{ id status createdAt } } } }", {"s": sid, "e": ENV})
        print(name, [(n["node"]["status"], n["node"]["createdAt"][11:19], n["node"]["id"][:8]) for n in r["deployments"]["edges"]])


def seed():
    set_pre_deploy(SEED_CMD)
    dep = gql("mutation($s:String!,$e:String!){ serviceInstanceDeployV2(serviceId:$s, environmentId:$e) }", {"s": WEB, "e": ENV})["serviceInstanceDeployV2"]
    print("deployment:", dep)
    st = None
    for _ in range(90):
        st = gql("query($d:String!){ deployment(id:$d){ status } }", {"d": dep})["deployment"]["status"]
        print(time.strftime("%H:%M:%S"), st, flush=True)
        if st in ("SUCCESS", "FAILED", "CRASHED", "REMOVED"):
            break
        time.sleep(20)
    logs = gql("query($d:String!,$n:Int!){ deploymentLogs(deploymentId:$d, limit:$n){ message timestamp } }", {"d": dep, "n": 3000})["deploymentLogs"]
    for l in logs:
        m = l["message"]
        if "demo:showcase" in m or "showcase" in m.lower() or "mirror" in m.lower() or "error" in m.lower():
            print(l["timestamp"][11:19], m[:300].replace("\n", " "))
    set_pre_deploy([])
    print("final status:", st)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    {"check": check, "seed": seed, "reset": lambda: set_pre_deploy([]), "status": status}.get(cmd, lambda: sys.exit(__doc__))()
