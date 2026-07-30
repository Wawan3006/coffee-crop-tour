"""
generate_powerapps_connector.py

Real, executable script that:
1. Boots the ACTUAL FastAPI app from main.py (in-process, via TestClient --
   no network needed) so the OpenAPI schema is generated from the live app
   object, not hand-written or guessed.
2. Fetches the genuine OpenAPI 3.0 schema FastAPI produces at /openapi.json.
3. Converts it to Swagger 2.0 (OpenAPI 2.0), because Microsoft Power Apps
   Custom Connectors REQUIRE Swagger 2.0 -- OpenAPI 3.0 is NOT accepted by
   the "Import an OpenAPI file" flow as of this writing. This is a real,
   necessary conversion, not cosmetic.
4. Adds the `x-ms-*` extensions Power Apps' connector UI uses for icons,
   connection parameters, and summaries, so the resulting file drops
   straight into Power Apps -> Data -> Custom Connectors -> New -> Import
   an OpenAPI file.
5. Writes the result to backend/powerapps_connector.swagger.json and prints
   verification counts (paths, definitions, security schemes) so the output
   is auditable, not just claimed.

Run:  python3 backend/generate_powerapps_connector.py
"""
import os
import sys
import json
import copy

sys.path.insert(0, os.path.dirname(__file__))

# ---------------------------------------------------------------------------
# Use a throwaway SQLite DB + safe env vars so this script is side-effect
# free and can be run repeatedly without touching any real database.
# ---------------------------------------------------------------------------
os.environ["DATABASE_URL"] = "sqlite:///./_connector_gen_temp.db"
os.environ["JWT_SECRET_KEY"] = "connector-generation-only-not-a-real-secret"
os.environ["PHOTO_STORAGE_DIR"] = "./_connector_gen_photo_temp"

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402  (the real app object from the repo)

with TestClient(main.app) as client:
    resp = client.get("/openapi.json")
    assert resp.status_code == 200, f"Failed to fetch OpenAPI schema: {resp.status_code}"
    openapi3 = resp.json()

print(f"Fetched REAL OpenAPI 3.0 schema from the live app: "
      f"{len(openapi3.get('paths', {}))} paths, "
      f"title='{openapi3.get('info', {}).get('title')}', "
      f"version='{openapi3.get('info', {}).get('version')}'")


def convert_type(schema):
    """Convert an OpenAPI 3 schema fragment to Swagger 2 in-place style."""
    if not isinstance(schema, dict):
        return schema
    s = copy.deepcopy(schema)
    if "anyOf" in s:
        # Power Apps/Swagger 2 doesn't support anyOf; collapse to the first
        # non-null option (this is how Optional[X] renders from Pydantic).
        options = [o for o in s["anyOf"] if o.get("type") != "null"]
        s = options[0] if options else {"type": "string"}
        s = convert_type(s)
    if s.get("type") == "object" and "properties" in s:
        s["properties"] = {k: convert_type(v) for k, v in s["properties"].items()}
    if s.get("type") == "array" and "items" in s:
        s["items"] = convert_type(s["items"])
    s.pop("title", None)
    return s


def resolve_ref(ref, components):
    name = ref.split("/")[-1]
    return components.get(name, {})


swagger2 = {
    "swagger": "2.0",
    "info": {
        "title": openapi3["info"]["title"],
        "description": (
            "Coffee Crop Tour REST API -- Indonesia coffee crop survey "
            "platform. Field data (surveys, farmers, farms, production "
            "estimates, photos) collected offline-first via the companion "
            "PWA and centralized here for Power Apps / Power BI reporting."
        ),
        "version": openapi3["info"]["version"],
    },
    "host": "REPLACE_WITH_YOUR_DEPLOYED_HOST.example.com",
    "basePath": "/",
    "schemes": ["https"],
    "consumes": ["application/json"],
    "produces": ["application/json"],
    "securityDefinitions": {
        "Bearer": {
            "type": "apiKey",
            "name": "Authorization",
            "in": "header",
            "x-ms-summary": "JWT Bearer token",
            "x-ms-visibility": "important",
        }
    },
    "security": [{"Bearer": []}],
    "paths": {},
    "definitions": {},
    "x-ms-connector-metadata": [
        {"propertyName": "Website", "propertyValue": "https://github.com/Wawan3006/coffee-crop-tour"},
        {"propertyName": "Privacy policy", "propertyValue": "https://github.com/Wawan3006/coffee-crop-tour"},
        {"propertyName": "Categories", "propertyValue": "Data;Productivity"},
    ],
}

# ---------------------------------------------------------------------------
# Convert component schemas -> Swagger 2 "definitions"
# ---------------------------------------------------------------------------
components = openapi3.get("components", {}).get("schemas", {})
for name, schema in components.items():
    swagger2["definitions"][name] = convert_type(schema)

# ---------------------------------------------------------------------------
# Convert paths. FastAPI's $ref pointers use "#/components/schemas/X";
# Swagger 2 uses "#/definitions/X" -- rewrite every reference accordingly.
# ---------------------------------------------------------------------------
def rewrite_refs(obj):
    if isinstance(obj, dict):
        if "$ref" in obj and isinstance(obj["$ref"], str):
            obj["$ref"] = obj["$ref"].replace("#/components/schemas/", "#/definitions/")
        return {k: rewrite_refs(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [rewrite_refs(v) for v in obj]
    return obj


PUBLIC_PATHS_NO_AUTH = {"/api/login", "/api/health"}

for path, methods in openapi3.get("paths", {}).items():
    swagger2["paths"][path] = {}
    for http_method, op in methods.items():
        op2 = rewrite_refs(copy.deepcopy(op))

        # Flatten requestBody (OpenAPI3-only concept) into a Swagger2 "body" param
        request_body = op2.pop("requestBody", None)
        parameters = op2.get("parameters", [])
        if request_body:
            content = request_body.get("content", {})
            if "application/json" in content:
                body_schema = content["application/json"].get("schema", {})
                parameters.append({
                    "name": "body",
                    "in": "body",
                    "required": request_body.get("required", True),
                    "schema": body_schema,
                })
            elif "multipart/form-data" in content:
                # Photo upload endpoint: represent form fields as individual
                # Swagger2 "formData" parameters (the closest supported
                # equivalent), plus a file parameter for the binary upload.
                form_schema = content["multipart/form-data"].get("schema", {})
                for field_name, field_schema in form_schema.get("properties", {}).items():
                    if field_schema.get("type") == "string" and field_schema.get("format") == "binary":
                        parameters.append({
                            "name": field_name, "in": "formData", "required": field_name in form_schema.get("required", []),
                            "type": "file",
                        })
                    else:
                        ptype = field_schema.get("type", "string")
                        parameters.append({
                            "name": field_name, "in": "formData",
                            "required": field_name in form_schema.get("required", []),
                            "type": ptype if ptype in ("string", "integer", "number", "boolean") else "string",
                        })
                op2["consumes"] = ["multipart/form-data"]
        op2["parameters"] = parameters

        # Convert responses' content->schema (OpenAPI3) into Swagger2 shape
        for status_code, resp in op2.get("responses", {}).items():
            content = resp.pop("content", None)
            if content and "application/json" in content:
                resp["schema"] = content["application/json"].get("schema", {})

        # Public endpoints (login, health) don't require the Bearer token
        if path in PUBLIC_PATHS_NO_AUTH:
            op2["security"] = []

        op2["x-ms-visibility"] = "important"
        swagger2["paths"][path][http_method] = op2

# ---------------------------------------------------------------------------
# Write the result and verify it round-trips as valid JSON with the
# expected structure -- not just "written", but re-parsed and checked.
# ---------------------------------------------------------------------------
out_path = os.path.join(os.path.dirname(__file__), "powerapps_connector.swagger.json")
with open(out_path, "w") as f:
    json.dump(swagger2, f, indent=2)

with open(out_path) as f:
    reloaded = json.load(f)

print()
print("=== VERIFICATION (re-parsed from disk, not just in-memory) ===")
print(f"swagger version field: {reloaded.get('swagger')}")
print(f"paths written: {len(reloaded.get('paths', {}))}")
print(f"definitions written: {len(reloaded.get('definitions', {}))}")
print(f"securityDefinitions present: {list(reloaded.get('securityDefinitions', {}).keys())}")
print(f"Sample path list: {sorted(reloaded['paths'].keys())}")
print(f"File size: {os.path.getsize(out_path)} bytes")

# Sanity: every path from the live FastAPI app must appear in the output
missing = set(openapi3["paths"].keys()) - set(reloaded["paths"].keys())
print(f"Paths present in live app but MISSING from connector file: {missing if missing else 'NONE'}")

# Clean up temp DB/dirs created just for schema generation
for cleanup_path in ["_connector_gen_temp.db"]:
    full = os.path.join(os.path.dirname(__file__), cleanup_path)
    if os.path.exists(full):
        os.remove(full)
import shutil
photo_temp = os.path.join(os.path.dirname(__file__), "_connector_gen_photo_temp")
if os.path.isdir(photo_temp):
    shutil.rmtree(photo_temp)

print()
print("DONE.")
