import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("sharepoint-uploader.py")
SPEC = importlib.util.spec_from_file_location("cv_sharepoint_uploader", SCRIPT)
uploader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(uploader)


class FakeReply:
    def __init__(self, status, body):
        self.status = status
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.body


class FakeMicrosoft:
    def __init__(self, size_change=0):
        self.data = bytearray()
        self.size_change = size_change
        self.calls = []

    def __call__(self, request, timeout=None):
        url = request.full_url
        self.calls.append((url, request.get_method()))
        if "oauth2/v2.0/token" in url:
            return FakeReply(200, {"access_token": "not-a-real-token"})
        if url.endswith("/drive"):
            return FakeReply(200, {"id": "fake-drive"})
        if "/root:/Database-Backups" in url:
            return FakeReply(200, {"id": "fake-folder"})
        if url.endswith(":/createUploadSession"):
            return FakeReply(200, {
                "uploadUrl": "https://walectra.sharepoint.com/_api/mockupload?key=private"
            })
        if "_api/mockupload" in url:
            self.data.extend(request.data)
            return FakeReply(201, {
                "id": "new-backup-id",
                "size": len(self.data) + self.size_change
            })
        raise AssertionError("Unexpected HTTP request")


class SharePointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.archive = Path(self.temp.name, "archive.cvbak")
        self.archive.write_bytes(b"CVBKP001" + b"X" * 50)
        self.env = {
            "CV_MS_TENANT_ID": "tenant",
            "CV_MS_CLIENT_ID": "client",
            "CV_MS_CLIENT_SECRET": "secret",
            "CV_BACKUP_SITE_ID": "walectra.sharepoint.com,site-id,web-id",
        }

    def test_rejects_plaintext_and_wrong_extension(self):
        self.archive.write_bytes(b"PGDMP" + b"X" * 70)
        with self.assertRaisesRegex(ValueError, "unencrypted"):
            uploader.checked_archive(self.archive)
        self.archive.rename(Path(self.temp.name, "archive.dump"))
        with self.assertRaisesRegex(ValueError, "encrypted"):
            uploader.checked_archive(Path(self.temp.name, "archive.dump"))

    def test_refuses_external_or_http_upload_urls(self):
        for bad in [
            "http://walectra.sharepoint.com/upload",
            "https://evil.example.com/upload",
            "https://walectra.sharepoint.com.evil.example.com/upload",
            "https://password@walectra.sharepoint.com/upload",
        ]:
            with self.subTest(url=bad):
                with self.assertRaisesRegex(ValueError, "Unsafe|recognized"):
                    uploader.check_upload_url(bad)

    def test_encrypted_file_upload_and_size_confirmed(self):
        stub = FakeMicrosoft()
        actual = uploader.upload_encrypted_archive(
            self.archive, env=self.env, opener=stub
        )
        self.assertTrue(actual["confirmed"])
        self.assertEqual(actual["bytes"], self.archive.stat().st_size)
        self.assertEqual(bytes(stub.data), self.archive.read_bytes())
        self.assertEqual(len([x for x in stub.calls if x[1] == "PUT"]), 1)

    def test_mismatched_sharepoint_size_rejected(self):
        stub = FakeMicrosoft(size_change=1)
        with self.assertRaisesRegex(RuntimeError, "confirm final"):
            uploader.upload_encrypted_archive(
                self.archive, env=self.env, opener=stub
            )

    def test_requires_credentials_without_logging_values(self):
        with self.assertRaisesRegex(ValueError, "CV_MS_TENANT_ID"):
            uploader.upload_encrypted_archive(self.archive, env={}, opener=FakeMicrosoft())


if __name__ == "__main__":
    unittest.main()
