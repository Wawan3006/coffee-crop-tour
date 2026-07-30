"""
auth.py — server-side authentication (Step 9).

Design choices, explained:
- Password hashing uses Python's built-in `hashlib.pbkdf2_hmac` (SHA-256,
  200,000 iterations, random 16-byte salt per user). This avoids depending
  on the `passlib` package, which is NOT installed in this environment
  (verified: `import passlib` raised ModuleNotFoundError). PBKDF2-HMAC-SHA256
  is a NIST-approved, industry-standard KDF and ships in every Python 3
  standard library -- no extra dependency needed to run this backend
  anywhere. A stronger KDF (e.g. bcrypt/argon2 via a third-party library)
  can be swapped in later with no other code changes, because the stored
  hash format below is self-describing:
  "pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>".
- Tokens are signed JWTs (python-jose, already installed) carrying user id,
  username and role so every request can be authorized without a DB hit.
"""
import os
import hmac
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from database import get_db
import models

JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-only-insecure-secret-change-me")
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "480"))

PBKDF2_ITERATIONS = 200_000

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login", auto_error=False)


# ---------------------------------------------------------------------------
# Password hashing (PBKDF2-HMAC-SHA256, stdlib only -- never plain text)
# ---------------------------------------------------------------------------

def hash_password(plain_password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(plain_password: str, stored_hash: str) -> bool:
    try:
        algo, iterations_str, salt_hex, hash_hex = stored_hash.split("$")
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iterations_str)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        candidate = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(candidate, expected)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT issuing / verification
# ---------------------------------------------------------------------------

def create_access_token(user: "models.User") -> str:
    expire = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {
        "sub": user.id,
        "username": user.username,
        "role": user.role.value if hasattr(user.role, "value") else user.role,
        "full_name": user.full_name,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


def get_current_user(token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> "models.User":
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(token)
    user = db.query(models.User).filter(models.User.id == payload.get("sub")).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def require_roles(*allowed_roles: str):
    """FastAPI dependency factory: require_roles("Manager", "Administrator")"""
    def _checker(user: "models.User" = Depends(get_current_user)) -> "models.User":
        role_val = user.role.value if hasattr(user.role, "value") else user.role
        if role_val not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role_val}' is not permitted to perform this action",
            )
        return user
    return _checker


# ---------------------------------------------------------------------------
# Permission matrix (Step 9) -- enforced via require_roles() on each endpoint
# ---------------------------------------------------------------------------

PERMISSIONS = {
    "Field Surveyor": {"create_survey", "edit_own_survey", "view_assigned_farms"},
    "Agronomist": {"create_survey", "edit_own_survey", "view_regional_surveys",
                   "validate_observations", "review_estimates"},
    "Manager": {"view_all_dashboards", "view_all_surveys", "export_reports", "adjust_estimate"},
    "Administrator": {"manage_users", "manage_master_data", "manage_system_config",
                       "create_survey", "edit_own_survey", "view_all_surveys",
                       "validate_observations", "review_estimates", "adjust_estimate",
                       "export_reports", "view_all_dashboards"},
}


def has_permission(role: str, permission: str) -> bool:
    return permission in PERMISSIONS.get(role, set())
