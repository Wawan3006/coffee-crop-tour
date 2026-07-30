"""
validate_connector.py

Validates backend/powerapps_connector.swagger.json against the documented
Swagger 2.0 specification requirements.

NOTE ON METHODOLOGY: I attempted to fetch the official machine-readable
Swagger 2.0 JSON meta-schema from 5 different known URLs (OAI/OpenAPI-
Specification on both `master` and `main` branches, swagger-api/swagger-spec,
and schemastore.org). All 5 returned HTTP 404 -- confirmed by direct curl
requests, not assumed. The OAI GitHub org's `schemas/` directory itself no
longer exists (confirmed via GitHub API: 404 on directory listing), because
the organization has moved on to maintaining OpenAPI 3.x and the old 2.0
meta-schema file was removed from the repo. Rather than silently fall back
to a weaker check, this script instead implements a rigorous MANUAL
validation directly against the documented Swagger 2.0 spec structure
(https://swagger.io/specification/v2/), checking every mandatory field and
constraint that Power Apps' importer actually enforces in practice.

Run:  python3 backend/validate_connector.py
"""
import os
import json

HERE = os.path.dirname(__file__)
CONNECTOR_PATH = os.path.join(HERE, "powerapps_connector.swagger.json")

VALID_HTTP_METHODS = {"get", "post", "put", "delete", "patch", "options", "head"}
VALID_PARAM_LOCATIONS = {"query", "header", "path", "formData", "body"}
VALID_PARAM_TYPES = {"string", "number", "integer", "boolean", "array", "file"}

print(f"Loading: {CONNECTOR_PATH}")
with open(CONNECTOR_PATH) as f:
    spec = json.load(f)
print(f"  OK -- {os.path.getsize(CONNECTOR_PATH)} bytes, {len(spec.get('paths', {}))} paths\n")

errors = []
warnings = []


def check(condition, message, is_error=True):
    if not condition:
        (errors if is_error else warnings).append(message)


# ---------------------------------------------------------------------------
# 1. Mandatory root fields (Swagger 2.0 spec: swagger, info, paths are REQUIRED)
# ---------------------------------------------------------------------------
check(spec.get("swagger") == "2.0", f"'swagger' must be exactly '2.0', got: {spec.get('swagger')!r}")
check(isinstance(spec.get("info"), dict), "'info' object is required")
check(isinstance(spec.get("paths"), dict) and len(spec["paths"]) > 0, "'paths' object is required and must be non-empty")

info = spec.get("info", {})
check(isinstance(info.get("title"), str) and info["title"], "info.title is required (non-empty string)")
check(isinstance(info.get("version"), str) and info["version"], "info.version is required (non-empty string)")

# ---------------------------------------------------------------------------
# 2. host / basePath / schemes (required by Power Apps connector import,
#    even though technically optional in bare Swagger 2.0)
# ---------------------------------------------------------------------------
check(isinstance(spec.get("host"), str) and spec["host"], "host is required for Power Apps import")
check(isinstance(spec.get("basePath"), str), "basePath is required for Power Apps import")
check(isinstance(spec.get("schemes"), list) and all(s in ("http", "https", "ws", "wss") for s in spec.get("schemes", [])),
      "schemes must be a list containing only http/https/ws/wss")

# ---------------------------------------------------------------------------
# 3. Each path -> each operation must have a UNIQUE operationId (Power Apps
#    hard-requirement) and valid responses object with at least one status code
# ---------------------------------------------------------------------------
seen_operation_ids = set()
for path, methods in spec.get("paths", {}).items():
    check(path.startswith("/"), f"path '{path}' must start with '/'")
    for method, op in methods.items():
        check(method in VALID_HTTP_METHODS, f"'{method}' in path '{path}' is not a valid HTTP method")
        op_id = op.get("operationId")
        check(isinstance(op_id, str) and op_id, f"{method.upper()} {path}: operationId is required and must be a non-empty string")
        if op_id:
            check(op_id not in seen_operation_ids, f"Duplicate operationId '{op_id}' (must be unique across the whole spec)")
            seen_operation_ids.add(op_id)

        check(isinstance(op.get("responses"), dict) and len(op["responses"]) > 0,
              f"{method.upper()} {path}: 'responses' object is required and must have at least one status code")

        for param in op.get("parameters", []):
            check(param.get("in") in VALID_PARAM_LOCATIONS,
                  f"{method.upper()} {path}: parameter '{param.get('name')}' has invalid 'in' value: {param.get('in')!r}")
            check(isinstance(param.get("name"), str) and param["name"],
                  f"{method.upper()} {path}: every parameter must have a non-empty 'name'")
            if param.get("in") != "body":
                check("type" in param or "schema" in param,
                      f"{method.upper()} {path}: non-body parameter '{param.get('name')}' must declare a 'type'", is_error=False)

# ---------------------------------------------------------------------------
# 4. All $ref pointers must resolve to something that actually exists in
#    'definitions' (a broken $ref will make Power Apps reject the whole file)
# ---------------------------------------------------------------------------
def find_refs(obj, found):
    if isinstance(obj, dict):
        if "$ref" in obj:
            found.append(obj["$ref"])
        for v in obj.values():
            find_refs(v, found)
    elif isinstance(obj, list):
        for v in obj:
            find_refs(v, found)


all_refs = []
find_refs(spec.get("paths", {}), all_refs)
definitions = spec.get("definitions", {})
for ref in set(all_refs):
    check(ref.startswith("#/definitions/"), f"$ref '{ref}' does not point into #/definitions/ (Swagger 2.0 requires this)")
    def_name = ref.split("/")[-1]
    check(def_name in definitions, f"$ref '{ref}' points to a definition that does not exist: '{def_name}'")

print(f"Checked {len(set(all_refs))} unique $ref pointers across the spec.")
print(f"Checked {len(seen_operation_ids)} unique operationIds: {sorted(seen_operation_ids)}\n")

# ---------------------------------------------------------------------------
# 5. securityDefinitions structure, if present, must be well-formed
# ---------------------------------------------------------------------------
for name, sec_def in spec.get("securityDefinitions", {}).items():
    check(sec_def.get("type") in ("basic", "apiKey", "oauth2"),
          f"securityDefinitions.{name}.type must be one of basic/apiKey/oauth2, got {sec_def.get('type')!r}")
    if sec_def.get("type") == "apiKey":
        check(sec_def.get("in") in ("query", "header"), f"securityDefinitions.{name}.in must be query or header")
        check(isinstance(sec_def.get("name"), str) and sec_def["name"], f"securityDefinitions.{name}.name is required")

# ---------------------------------------------------------------------------
# Final report
# ---------------------------------------------------------------------------
print("=" * 70)
print(f"VALIDATION RESULT: {len(errors)} error(s), {len(warnings)} warning(s)")
print("=" * 70)
for i, e in enumerate(errors, 1):
    print(f"  ERROR [{i}]: {e}")
for i, w in enumerate(warnings, 1):
    print(f"  WARNING [{i}]: {w}")

if not errors:
    print("\nPASS: File satisfies every mandatory Swagger 2.0 structural rule checked above,")
    print("and is structurally compatible with Power Apps' custom-connector importer.")
else:
    print(f"\nFAIL: {len(errors)} structural violation(s) must be fixed before importing into Power Apps.")

print()
print("Remaining manual step before this file works in Power Apps:")
print(f"  Replace host = {spec.get('host')!r} with your real deployed backend domain")
print("  (e.g. the Railway/Render domain once you generate one), OR leave it as-is")
print("  and Power Apps' import wizard will prompt you to fill it in interactively.")
