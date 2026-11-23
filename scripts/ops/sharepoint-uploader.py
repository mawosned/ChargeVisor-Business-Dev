#!/usr/bin/env python3
"""Upload ONLY authenticated/encrypted ChargeVisor archives to a selected SharePoint site.

Intended for a private, approved scheduler, never for publishing customer data
in a public GitHub repo or public Actions artifacts. No secret values in logs.
"""
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

GRAPH = "https://graph.microsoft.com/v1.0"
CHUNK_SIZE = 5 * 1024 * 1024  # Multiples of 320 KiB required for Graph sessions.
MAGIC = b"CVBKP001"
ARCHIVE_EXTENSIONS = frozenset({".cvbak", ".cvcsv"})


def checked_archive(file):
    p = Path(file)
    if p.suffix not in ARCHIVE_EXTENSIONS or not p.is_file():
        raise ValueError("Only encrypted .cvbak or .cvcsv files can be uploaded")
    if p.stat().st_size <= 8 + 12 + 16:
        raise ValueError("Archive is missing or truncated")
    with p.open("rb") as f:
        if f.read(len(MAGIC)) != MAGIC:
            raise ValueError("Refusing unencrypted/mismatched ChargeVisor archive")
    return p


def check_upload_url(value):
    u = urlparse(value)
    host = (u.hostname or "").lower()
    if u.scheme != "https" or not host or u.username or u.password or u.fragment:
        raise ValueError("Unsafe upload session URL")
    if not (host.endswith(".sharepoint.com") or host.endswith(".1drv.com")):
        raise ValueError("Upload session host not recognized")
    return value


def must(env, name):
    val = env.get(name)
    if not val:
        raise ValueError("Missing required environment setting: " + name)
    return val


def request_json(url, *, method="GET", bearer=None, data=None,
                 headers=None, opener=urlopen):
    hdr = dict(headers or {})
    if bearer:
        hdr["Authorization"] = "Bearer " + bearer
    if data is not None and "Content-Type" not in hdr:
        hdr["Content-Type"] = "application/json"
    try:
        with opener(Request(url, data=data, headers=hdr, method=method), timeout=180) as res:
            content = res.read()
            return res.status, json.loads(content) if content else {}
    except HTTPError as error:
        # Never log the requested URL, headers, request body, or access tokens.
        raise RuntimeError("Microsoft Graph/upload HTTP " + str(error.code)) from None


def upload_encrypted_archive(file, *, env=None, opener=urlopen):
    env = os.environ if env is None else env
    p = checked_archive(file)
    size = p.stat().st_size
    tenant = quote(must(env, "CV_MS_TENANT_ID"), safe="")
    form = urlencode({
        "client_id": must(env, "CV_MS_CLIENT_ID"),
        "client_secret": must(env, "CV_MS_CLIENT_SECRET"),
        "grant_type": "client_credentials",
        "scope": "https://graph.microsoft.com/.default",
    }).encode("utf-8")
    _, response = request_json(
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        method="POST", data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"}, opener=opener,
    )
    token = response.get("access_token")
    if not token:
        raise RuntimeError("Microsoft identity platform returned no access token")
    site_id = quote(must(env, "CV_BACKUP_SITE_ID"), safe=",")
    _, drive = request_json(f"{GRAPH}/sites/{site_id}/drive",
                            bearer=token, opener=opener)
    drive_id = quote(drive["id"], safe="")
    folder_name = env.get("CV_BACKUP_FOLDER", "Database-Backups")
    if not folder_name or folder_name in (".", "..") or "/" in folder_name or "\\" in folder_name:
        raise ValueError("Invalid SharePoint archive folder name")
    folder_url = f"{GRAPH}/drives/{drive_id}/root:/{quote(folder_name, safe='')}"
    _, folder = request_json(folder_url, bearer=token, opener=opener)
    folder_id = quote(folder["id"], safe="")
    filename = quote(p.name, safe="")
    payload = json.dumps({
        "item": {"@microsoft.graph.conflictBehavior": "fail", "name": p.name}
    }).encode("utf-8")
    _, session = request_json(
        f"{GRAPH}/drives/{drive_id}/items/{folder_id}:/{filename}:/createUploadSession",
        method="POST", bearer=token, data=payload, opener=opener,
    )
    upload_url = check_upload_url(session["uploadUrl"])
    offset = 0
    last_response = None
    with p.open("rb") as stream:
        while offset < size:
            block = stream.read(CHUNK_SIZE)
            if not block:
                raise RuntimeError("Unexpected end of encrypted archive")
            end = offset + len(block) - 1
            status, last_response = request_json(
                upload_url, method="PUT", data=block,
                headers={
                    "Content-Type": "application/octet-stream",
                    "Content-Range": f"bytes {offset}-{end}/{size}",
                },
                opener=opener,
            )
            if status not in (200, 201, 202):
                raise RuntimeError("SharePoint did not accept upload chunk")
            if end + 1 < size and status != 202:
                raise RuntimeError("Upload committed too early")
            offset = end + 1
    if not isinstance(last_response, dict) or not last_response.get("id") or last_response.get("size") != size:
        raise RuntimeError("SharePoint did not confirm final encrypted file size")
    return {"name": p.name, "bytes": size, "confirmed": True}


if __name__ == "__main__":
    try:
        result = upload_encrypted_archive(os.environ["BACKUP_FILE"])
        print(json.dumps({"result": "PASS", **result}))
    except Exception as error:
        print("Secure SharePoint upload FAILED: " + str(error), file=sys.stderr)
        sys.exit(1)
